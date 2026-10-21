import type { CorrectionProfile } from '../annotations/profile.ts';
import { listErrors, type AnnotatedError, type Transcript } from '../annotations/transcript.ts';
import { codeFor } from '../correction/kinds.ts';

export const WEIGHT_STEPS: readonly number[] = [0, 0.5, 1, 1.5, 2];

export interface Weighting {
  readonly weights: Readonly<Record<string, number>>;
  readonly repeatsOnce: boolean;
}

export interface WeightedStatistics {
  readonly words: number;
  readonly weighted: number;
  readonly quotient: number;
}

const FOREIGN: ReadonlySet<CorrectionProfile['language']> = new Set(['en', 'fr', 'es']);
const NEVER_REPEATED: ReadonlySet<string> = new Set(['das', 'dass']);

function defaultWeight(profile: CorrectionProfile, code: string): number {
  if (!FOREIGN.has(profile.language)) return 1;
  if (code === codeFor(profile, 'spelling')) return 0.5;
  if (code === codeFor(profile, 'punctuation')) return 0;
  return 1;
}

export function defaultWeighting(profile: CorrectionProfile): Weighting {
  return {
    weights: Object.fromEntries(
      profile.allowedTypes.map((code) => [code, defaultWeight(profile, code)]),
    ),
    repeatsOnce: true,
  };
}

export function weightOf(weighting: Weighting, code: string): number {
  return weighting.weights[code] ?? 1;
}

export function sameWeighting(profile: CorrectionProfile, a: Weighting, b: Weighting): boolean {
  return (
    a.repeatsOnce === b.repeatsOnce &&
    profile.allowedTypes.every((code) => weightOf(a, code) === weightOf(b, code))
  );
}

function repeatKey(error: AnnotatedError, profile: CorrectionProfile): string | null {
  if (error.kind !== 'error') return null;
  if (error.type === codeFor(profile, 'punctuation')) return null;
  const original = error.original.toLowerCase();
  const correction = error.correction.toLowerCase();
  if (NEVER_REPEATED.has(original) && NEVER_REPEATED.has(correction)) return null;
  return JSON.stringify([error.type, error.original, error.correction]);
}

export function weightedErrors(
  transcripts: readonly Transcript[],
  profile: CorrectionProfile,
  weighting: Weighting,
): number {
  const seen = new Set<string>();
  let total = 0;
  for (const transcript of transcripts) {
    for (const error of listErrors(transcript)) {
      const key = weighting.repeatsOnce ? repeatKey(error, profile) : null;
      if (key !== null) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      total += weightOf(weighting, error.type);
    }
  }
  return total;
}

export function weightedStatistics(
  words: number,
  transcripts: readonly Transcript[],
  profile: CorrectionProfile,
  weighting: Weighting,
): WeightedStatistics {
  const weighted = weightedErrors(transcripts, profile, weighting);
  return { words, weighted, quotient: words === 0 ? 0 : (weighted / words) * 100 };
}

export function combineWeighted(list: readonly WeightedStatistics[]): WeightedStatistics | null {
  if (list.length === 0) return null;
  const words = list.reduce((sum, entry) => sum + entry.words, 0);
  const weighted = list.reduce((sum, entry) => sum + entry.weighted, 0);
  return { words, weighted, quotient: words === 0 ? 0 : (weighted / words) * 100 };
}

export function formatWeighted(value: number): string {
  return value.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}
