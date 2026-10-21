import type { CorrectionProfile } from '../annotations/profile.ts';
import type { CorrectError, CorrectResult, Corrector } from './corrector.ts';
import type { CorrectionScope } from './scope.ts';

export type FakeScript =
  | string
  | ((lines: readonly string[], profile: CorrectionProfile) => string)
  | { readonly error: CorrectError };

export interface FakeCall {
  readonly lines: readonly string[];
  readonly profile: CorrectionProfile;
  readonly scope?: CorrectionScope;
}

export type FakeCorrector = Corrector & { readonly calls: readonly FakeCall[] };

export function createFakeCorrector(script: FakeScript): FakeCorrector {
  const calls: FakeCall[] = [];
  return {
    calls,
    correct(lines, profile, signal, scope): Promise<CorrectResult> {
      calls.push({ lines, profile, ...(scope !== undefined && { scope }) });
      if (signal.aborted) return Promise.resolve({ ok: false, error: { kind: 'cancelled' } });
      if (typeof script === 'object') return Promise.resolve({ ok: false, error: script.error });
      const correctedText = typeof script === 'string' ? script : script(lines, profile);
      return Promise.resolve({ ok: true, correctedText });
    },
  };
}
