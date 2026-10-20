import { CATALOG } from '../annotations/catalog.ts';
import { LlmCallError } from '../llm/client.ts';
import type { LlmClient } from '../llm/client.ts';
import type { ChatMessage, LlmError } from '../llm/types.ts';
import type { CorrectError, CorrectResult, Corrector } from './corrector.ts';

export type LineMode = 'plain' | 'numbered';

export interface CorrectorConfig {
  readonly system?: string;
  readonly promptTemplate: string;
  readonly lineMode: LineMode;
  readonly maxOutputTokens: number;
  readonly temperature: number;
}

export interface LlmCorrectorDeps {
  readonly client: Pick<LlmClient, 'complete'>;
  readonly config: CorrectorConfig;
  readonly prepare?: (signal: AbortSignal) => Promise<void>;
}

export const TEXT_PLACEHOLDER = '{text}';
export const SUBJECT_PLACEHOLDER = '{subject}';
export const LANGUAGE_PLACEHOLDER = '{language}';

const INCOMPLETE_MESSAGE = 'Die Antwort des Modells war unvollständig';
const EMPTY_MESSAGE = 'Das Modell hat keinen Text geliefert';
const MISSING_LINES_MESSAGE = 'Die Antwort des Modells enthält nicht alle Zeilen';

interface PromptValues {
  readonly subject: string;
  readonly language: string;
  readonly text: string;
}

export function renderPrompt(template: string, values: PromptValues): string {
  return template
    .replaceAll(SUBJECT_PLACEHOLDER, () => values.subject)
    .replaceAll(LANGUAGE_PLACEHOLDER, () => values.language)
    .replaceAll(TEXT_PLACEHOLDER, () => values.text);
}

export function cleanAnswer(answer: string): string | null {
  let text = answer.replaceAll(/<think>[\s\S]*?<\/think>/gu, '');
  if (text.includes('<think>')) return null;
  text = text.trim();
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/u.exec(text);
  if (fenced?.[1] !== undefined) text = fenced[1].trim();
  return text;
}

export function numberLines(lines: readonly string[]): string {
  return lines.flatMap((line, index) => (line === '' ? [] : [`${index + 1}: ${line}`])).join('\n');
}

export function readNumberedLines(
  lines: readonly string[],
  answer: string,
): { correctedText: string; issues: string[] } {
  const expected = new Set(lines.flatMap((line, index) => (line === '' ? [] : [index + 1])));
  const found = new Map<number, string>();
  for (const row of answer.split('\n')) {
    const match = /^\s*(\d+)\s*[:.)]\s?(.*)$/u.exec(row);
    const number = Number(match?.[1]);
    if (expected.has(number) && !found.has(number)) found.set(number, (match?.[2] ?? '').trim());
  }
  const issues = [...expected]
    .filter((number) => !found.has(number))
    .map((number) => `Zeile ${number} fehlt in der Ausgabe.`);
  const correctedText = lines.map((line, index) => found.get(index + 1) ?? line).join('\n');
  return { correctedText, issues };
}

export function repairMessages(
  messages: readonly ChatMessage[],
  answer: string,
  issues: readonly string[],
): ChatMessage[] {
  return [
    ...messages,
    { role: 'assistant', content: answer },
    {
      role: 'user',
      content: `Die Ausgabe ist nicht gültig:\n${issues.map((issue) => `- ${issue}`).join('\n')}\nGib alle Zeilen noch einmal mit ihrer Nummer aus.`,
    },
  ];
}

function describeLlmError(error: LlmError): CorrectError {
  switch (error.kind) {
    case 'cancelled':
      return { kind: 'cancelled' };
    case 'modelNotFound':
    case 'invalidModelName':
      return {
        kind: 'unavailable',
        message: 'Das Korrekturmodell fehlt oder wurde gelöscht',
      };
    case 'sidecarMissing':
      return { kind: 'unavailable', message: 'Das Modellprogramm fehlt in dieser Installation' };
    case 'exitedDuringStartup':
    case 'exitedUnexpectedly':
      return {
        kind: 'failed',
        message:
          'Das Korrekturmodell wurde beendet. Vermutlich reicht der Arbeitsspeicher nicht aus',
      };
    case 'startupTimeout':
      return { kind: 'failed', message: 'Das Korrekturmodell ist nicht rechtzeitig gestartet' };
    case 'timeout':
      return { kind: 'failed', message: 'Die Korrektur hat zu lange gedauert' };
    case 'notReady':
    case 'spawnFailed':
    case 'environment':
    case 'invalidRequest':
    case 'request':
    case 'server':
      return {
        kind: 'failed',
        message: `Das Korrekturmodell hat einen internen Fehler gemeldet (${error.kind})`,
      };
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}

function failure(message: string): CorrectResult {
  return { ok: false, error: { kind: 'failed', message } };
}

export function createLlmCorrector(deps: LlmCorrectorDeps): Corrector {
  const { client, config, prepare } = deps;
  if (!config.promptTemplate.includes(TEXT_PLACEHOLDER)) {
    throw new Error(`Die Vorlage muss ${TEXT_PLACEHOLDER} enthalten.`);
  }

  return {
    async correct(lines, profile, signal): Promise<CorrectResult> {
      try {
        signal.throwIfAborted();
        await prepare?.(signal);
        const values = {
          subject: profile.subject,
          language: CATALOG[profile.language].name,
          text: config.lineMode === 'numbered' ? numberLines(lines) : lines.join('\n'),
        };
        const messages: ChatMessage[] = [
          ...(config.system === undefined
            ? []
            : [{ role: 'system' as const, content: renderPrompt(config.system, values) }]),
          { role: 'user', content: renderPrompt(config.promptTemplate, values) },
        ];
        const ask = async (conversation: readonly ChatMessage[]) => {
          const answer = await client.complete(
            {
              messages: [...conversation],
              temperature: config.temperature,
              max_tokens: config.maxOutputTokens,
            },
            { signal },
          );
          return answer.finishReason === 'length' ? null : cleanAnswer(answer.text);
        };

        const first = await ask(messages);
        if (first === null) return failure(INCOMPLETE_MESSAGE);
        if (first === '') return failure(EMPTY_MESSAGE);
        if (config.lineMode === 'plain') return { ok: true, correctedText: first };

        const firstRead = readNumberedLines(lines, first);
        if (firstRead.issues.length === 0)
          return { ok: true, correctedText: firstRead.correctedText };
        const second = await ask(repairMessages(messages, first, firstRead.issues));
        if (second === null) return failure(INCOMPLETE_MESSAGE);
        const secondRead = readNumberedLines(lines, second);
        if (secondRead.issues.length > 0) return failure(MISSING_LINES_MESSAGE);
        return { ok: true, correctedText: secondRead.correctedText };
      } catch (error) {
        if (signal.aborted) return { ok: false, error: { kind: 'cancelled' } };
        if (error instanceof LlmCallError)
          return { ok: false, error: describeLlmError(error.error) };
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
