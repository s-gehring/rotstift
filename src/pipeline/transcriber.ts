export type TranscribeError =
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string };

export type TranscribeResult =
  | { readonly ok: true; readonly lines: readonly string[] }
  | { readonly ok: false; readonly error: TranscribeError };

export interface PageTranscriber {
  transcribe(png: Blob, signal: AbortSignal): Promise<TranscribeResult>;
}

export type TranscriberStatus =
  | { readonly state: 'ready'; readonly transcriber: PageTranscriber; readonly demo: boolean }
  | { readonly state: 'unavailable'; readonly message: string };

export function describeError(error: TranscribeError): string {
  switch (error.kind) {
    case 'unavailable':
      return `Die Texterkennung ist nicht verfügbar: ${error.message}`;
    case 'cancelled':
      return 'Die Erkennung wurde abgebrochen.';
    case 'failed':
      return `Die Erkennung ist fehlgeschlagen: ${error.message}`;
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}
