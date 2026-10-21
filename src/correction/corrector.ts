import type { CorrectionProfile } from '../annotations/profile.ts';
import type { CorrectionScope } from './scope.ts';

export type CorrectError =
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string; readonly detail?: string };

export type CorrectResult =
  | { readonly ok: true; readonly correctedText: string }
  | { readonly ok: false; readonly error: CorrectError };

export interface Corrector {
  correct(
    lines: readonly string[],
    profile: CorrectionProfile,
    signal: AbortSignal,
    scope?: CorrectionScope,
  ): Promise<CorrectResult>;
}

function detail(message: string): string {
  return message.trim().replace(/[.:]+$/u, '');
}

export function describeCorrectError(error: CorrectError): string {
  switch (error.kind) {
    case 'unavailable':
      return `Die Korrektur ist nicht verfügbar (${detail(error.message)}).`;
    case 'cancelled':
      return 'Die Korrektur wurde abgebrochen.';
    case 'failed':
      return `Der Text konnte nicht korrigiert werden (${detail(error.message)}).`;
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}
