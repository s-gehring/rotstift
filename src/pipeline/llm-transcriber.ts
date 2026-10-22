import { cloudUnavailable, describeCloudError } from '../cloud/errors.ts';
import { readWords, type PageReading } from '../correction/uncertain-reading.ts';
import { LlmCallError, visionMessage, type Completion } from '../llm/client.ts';
import {
  createLlmEngine,
  type EngineClient,
  type EngineLease,
  type LlmEngine,
} from '../llm/engine.ts';
import { modelImage } from '../llm/image.ts';
import type { LlmError } from '../llm/types.ts';
import type { ModelInfo } from '../models/registry.ts';
import { isDegenerateAnswer, parseTranscript } from './transcript-lines.ts';
import type {
  EngineMonitor,
  PageTranscriber,
  TranscribeError,
  TranscribeResult,
} from './transcriber.ts';

export type { EngineClient } from '../llm/engine.ts';

export interface LlmTranscriberDeps {
  readonly client: EngineClient;
  readonly model: ModelInfo;
  readonly engine?: LlmEngine;
  readonly encode?: (png: Blob, maxEdge: number) => Promise<string>;
  readonly now?: () => number;
  readonly onUnavailable?: () => void;
}

export type LlmTranscriber = PageTranscriber & { readonly engine: EngineMonitor };

export const RETRY_REPEAT_PENALTY = 1.15;

const INCOMPLETE_MESSAGE =
  'Die Antwort des Modells war unvollständig. Bitte die Seite erneut erkennen lassen.';
const LOOP_MESSAGE =
  'Das Modell hat sich bei dieser Seite auch im zweiten Versuch in einer Wiederholung verfangen. Bei kleinen oder unscharfen Scans hilft ein neuer Scan mit höherer Auflösung (mindestens 150 dpi).';

const MEMORY_HINT =
  'Vermutlich reicht der freie Arbeitsspeicher nicht aus. Bitte andere Programme schließen.';

export function describeLlmError(error: LlmError): TranscribeError {
  switch (error.kind) {
    case 'cancelled':
      return { kind: 'cancelled' };
    case 'modelNotFound':
    case 'invalidModelName':
      return {
        kind: 'unavailable',
        message:
          'Das Erkennungsmodell fehlt oder wurde gelöscht. Bitte die Texterkennung neu einrichten',
      };
    case 'sidecarMissing':
      return {
        kind: 'unavailable',
        message: 'Das Erkennungsprogramm fehlt in dieser Installation',
      };
    case 'exitedDuringStartup':
      return {
        kind: 'failed',
        message: `Die Texterkennung konnte nicht gestartet werden. ${MEMORY_HINT}`,
        crashed: true,
      };
    case 'exitedUnexpectedly':
      return {
        kind: 'failed',
        message: `Die Texterkennung wurde unerwartet beendet. ${MEMORY_HINT}`,
        crashed: true,
      };
    case 'startupTimeout':
      return {
        kind: 'failed',
        message: 'Die Texterkennung ist nicht rechtzeitig gestartet. Bitte erneut versuchen',
      };
    case 'timeout':
      return { kind: 'failed', message: 'Die Erkennung dieser Seite hat zu lange gedauert' };
    case 'notReady':
    case 'spawnFailed':
    case 'environment':
    case 'invalidRequest':
    case 'request':
    case 'server':
      return {
        kind: 'failed',
        message: `Die Texterkennung hat einen internen Fehler gemeldet (${error.kind})`,
      };
    case 'cloud':
      if (error.detail === 'cancelled') return { kind: 'cancelled' };
      return cloudUnavailable(error.detail)
        ? { kind: 'unavailable', message: describeCloudError(error.detail) }
        : { kind: 'failed', message: describeCloudError(error.detail) };
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}

function failure(error: unknown): TranscribeResult {
  if (error instanceof LlmCallError) return { ok: false, error: describeLlmError(error.error) };
  return {
    ok: false,
    error: { kind: 'failed', message: error instanceof Error ? error.message : String(error) },
  };
}

function incomplete(message: string): TranscribeResult {
  return { ok: false, error: { kind: 'failed', message } };
}

function pageReading(
  answer: Completion,
  lines: readonly string[],
  uncertainBelow: number | null,
): PageReading | null {
  if (uncertainBelow === null || answer.logprobs === undefined) return null;
  const words = readWords(answer.text, answer.logprobs, lines);
  return words === null ? null : { lines: words, uncertainBelow };
}

export function createLlmTranscriber(deps: LlmTranscriberDeps): LlmTranscriber {
  const { client, model } = deps;
  const encode = deps.encode ?? modelImage;
  const engine = deps.engine ?? createLlmEngine(client, deps.now);

  return {
    engine: engine.monitor(model.id),

    async recover() {
      await engine.reset(model.id);
    },

    async transcribe(png, signal, onPhase): Promise<TranscribeResult> {
      let lease: EngineLease | null = null;
      try {
        lease = await engine.acquire(model, signal, {
          onWaiting: () => onPhase?.('queued'),
          onStarting: () => onPhase?.('sidecar_start'),
        });
        onPhase?.('encoding');
        const image = await encode(png, model.request.imageMaxEdge);
        signal.throwIfAborted();
        onPhase?.('request');
        const ask = (repeatPenalty?: number) =>
          client.complete(
            {
              messages: [visionMessage(model.prompt, [image])],
              temperature: model.request.temperature,
              max_tokens: model.request.maxOutputTokens,
              ...(model.request.uncertainBelow !== null && { logprobs: true }),
              ...(repeatPenalty !== undefined && { repeat_penalty: repeatPenalty }),
            },
            { signal },
          );
        let answer = await ask();
        onPhase?.('parsing');
        let { lines, removedThinking } = parseTranscript(answer.text);
        if (removedThinking && lines.length === 0) return incomplete(INCOMPLETE_MESSAGE);
        if (isDegenerateAnswer(answer.finishReason, lines)) {
          onPhase?.('request');
          answer = await ask(RETRY_REPEAT_PENALTY);
          onPhase?.('parsing');
          ({ lines, removedThinking } = parseTranscript(answer.text));
          if (removedThinking && lines.length === 0) return incomplete(INCOMPLETE_MESSAGE);
          if (isDegenerateAnswer(answer.finishReason, lines)) return incomplete(LOOP_MESSAGE);
        }
        const reading = pageReading(answer, lines, model.request.uncertainBelow);
        return { ok: true, lines, startupMs: lease.startupMs, ...(reading && { reading }) };
      } catch (error) {
        if (signal.aborted) return { ok: false, error: { kind: 'cancelled' } };
        if (error instanceof LlmCallError && error.error.kind === 'exitedUnexpectedly') {
          engine.markFailed(model.id);
        }
        const result = failure(error);
        if (!result.ok && result.error.kind === 'unavailable') deps.onUnavailable?.();
        return result;
      } finally {
        lease?.release();
      }
    },
  };
}
