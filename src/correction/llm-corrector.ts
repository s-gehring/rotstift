import { CATALOG } from '../annotations/catalog.ts';
import { LlmCallError } from '../llm/client.ts';
import type { LlmClient } from '../llm/client.ts';
import type { LlmError } from '../llm/types.ts';
import type { CorrectError, CorrectResult, Corrector } from './corrector.ts';

export interface CorrectorConfig {
  readonly promptTemplate: string;
  readonly maxOutputTokens: number;
  readonly temperature: number;
}

export interface LlmCorrectorDeps {
  readonly client: Pick<LlmClient, 'complete'>;
  readonly config: CorrectorConfig;
  readonly prepare?: (signal: AbortSignal) => Promise<void>;
}

export const TEXT_PLACEHOLDER = '{{text}}';
export const SUBJECT_PLACEHOLDER = '{{subject}}';
export const LANGUAGE_PLACEHOLDER = '{{language}}';

const INCOMPLETE_MESSAGE = 'Die Antwort des Modells war unvollständig';
const EMPTY_MESSAGE = 'Das Modell hat keinen Text geliefert';

export function renderPrompt(
  template: string,
  values: { text: string; subject: string; language: string },
): string {
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
        const prompt = renderPrompt(config.promptTemplate, {
          text: lines.join('\n'),
          subject: profile.subject,
          language: CATALOG[profile.language].name,
        });
        const answer = await client.complete(
          {
            messages: [{ role: 'user', content: prompt }],
            temperature: config.temperature,
            max_tokens: config.maxOutputTokens,
          },
          { signal },
        );
        if (answer.finishReason === 'length') {
          return { ok: false, error: { kind: 'failed', message: INCOMPLETE_MESSAGE } };
        }
        const correctedText = cleanAnswer(answer.text);
        if (correctedText === null) {
          return { ok: false, error: { kind: 'failed', message: INCOMPLETE_MESSAGE } };
        }
        if (correctedText === '') {
          return { ok: false, error: { kind: 'failed', message: EMPTY_MESSAGE } };
        }
        return { ok: true, correctedText };
      } catch (error) {
        if (signal.aborted) return { ok: false, error: { kind: 'cancelled' } };
        if (error instanceof LlmCallError)
          return { ok: false, error: describeLlmError(error.error) };
        return {
          ok: false,
          error: {
            kind: 'failed',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };
}
