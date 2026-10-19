import { LlmCallError, visionMessage, type LlmClient } from '../llm/client.ts';
import { modelImage } from '../llm/image.ts';
import type { LlmError } from '../llm/types.ts';
import type { ModelInfo } from '../models/registry.ts';
import { splitTranscript } from './transcript-lines.ts';
import type {
  EngineMonitor,
  EnginePhase,
  PageTranscriber,
  TranscribeError,
  TranscribeResult,
} from './transcriber.ts';

export type EngineClient = Pick<LlmClient, 'status' | 'startModel' | 'complete'>;

export interface LlmTranscriberDeps {
  readonly client: EngineClient;
  readonly model: ModelInfo;
  readonly encode?: (png: Blob, maxEdge: number) => Promise<string>;
}

export type LlmTranscriber = PageTranscriber & { readonly engine: EngineMonitor };

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
      };
    case 'exitedUnexpectedly':
      return {
        kind: 'failed',
        message: `Die Texterkennung wurde unerwartet beendet. ${MEMORY_HINT}`,
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

function untilAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new LlmCallError({ kind: 'cancelled' }));
      return;
    }
    const onAbort = () => {
      reject(new LlmCallError({ kind: 'cancelled' }));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

export function createLlmTranscriber(deps: LlmTranscriberDeps): LlmTranscriber {
  const { client, model } = deps;
  const encode = deps.encode ?? modelImage;
  const listeners = new Set<() => void>();
  let phase: EnginePhase = 'idle';
  let starting: Promise<void> | null = null;

  const setPhase = (next: EnginePhase) => {
    if (phase === next) return;
    phase = next;
    for (const listener of listeners) listener();
  };

  const start = async () => {
    setPhase('starting');
    try {
      const status = await client.startModel(model.id);
      if (status.state !== 'ready') {
        throw new LlmCallError(status.state === 'failed' ? status.error : { kind: 'notReady' });
      }
      setPhase('ready');
    } catch (error) {
      setPhase('failed');
      throw error;
    }
  };

  const ensureRunning = async () => {
    if (starting === null) {
      const status = await client.status();
      if (status.state === 'ready' && status.model === model.files.model.name) {
        setPhase('ready');
        return;
      }
      starting ??= start().finally(() => {
        starting = null;
      });
    }
    await starting;
  };

  return {
    engine: {
      getPhase: () => phase,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },

    async transcribe(png, signal): Promise<TranscribeResult> {
      try {
        await untilAbort(ensureRunning(), signal);
        const image = await encode(png, model.request.imageMaxEdge);
        signal.throwIfAborted();
        const answer = await client.complete(
          {
            messages: [visionMessage(model.prompt, [image])],
            temperature: model.request.temperature,
            max_tokens: model.request.maxOutputTokens,
          },
          { signal },
        );
        return { ok: true, lines: splitTranscript(answer) };
      } catch (error) {
        if (signal.aborted) return { ok: false, error: { kind: 'cancelled' } };
        if (error instanceof LlmCallError && error.error.kind === 'exitedUnexpectedly') {
          setPhase('failed');
        }
        return failure(error);
      }
    },
  };
}
