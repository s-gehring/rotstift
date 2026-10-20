import type { PageReading } from '../correction/uncertain-reading.ts';

export type TranscribeError =
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'failed';
      readonly message: string;
      readonly crashed?: boolean;
      readonly stalled?: boolean;
    };

export type TranscribeResult =
  | {
      readonly ok: true;
      readonly lines: readonly string[];
      readonly startupMs?: number;
      readonly reading?: PageReading;
    }
  | { readonly ok: false; readonly error: TranscribeError };

export type PagePhase =
  'rendering' | 'queued' | 'sidecar_start' | 'encoding' | 'request' | 'parsing';

export interface PageTranscriber {
  transcribe(
    png: Blob,
    signal: AbortSignal,
    onPhase?: (phase: PagePhase) => void,
  ): Promise<TranscribeResult>;
  recover?(): Promise<void>;
}

export type EnginePhase = 'idle' | 'starting' | 'ready' | 'failed';

export interface EngineMonitor {
  readonly getPhase: () => EnginePhase;
  readonly subscribe: (listener: () => void) => () => void;
}

export type ModelProblem =
  'missing' | 'downloading' | 'verifying' | 'importing' | 'deleting' | 'corrupt';

export type TranscriberStatus =
  | {
      readonly state: 'ready';
      readonly transcriber: PageTranscriber;
      readonly demo: boolean;
      readonly engine?: EngineMonitor;
    }
  | { readonly state: 'needs-model'; readonly problem: ModelProblem }
  | { readonly state: 'unavailable'; readonly message: string };

function detail(message: string): string {
  return message.trim().replace(/[.:]+$/u, '');
}

export function describeError(error: TranscribeError): string {
  switch (error.kind) {
    case 'unavailable':
      return `Die Texterkennung ist nicht verfügbar (${detail(error.message)}).`;
    case 'cancelled':
      return 'Die Erkennung wurde abgebrochen.';
    case 'failed':
      return `Die Seite konnte nicht erkannt werden (${detail(error.message)}).`;
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}
