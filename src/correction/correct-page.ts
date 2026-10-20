import { formatIssues, parseTranscript } from '../annotations/parse.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';
import { serializeTranscript } from '../annotations/serialize.ts';
import { transcriptSchema } from '../annotations/transcript.ts';
import type { Bbox, Transcript } from '../annotations/transcript.ts';
import { computeStatistics } from '../stats/statistics.ts';
import type { Statistics } from '../stats/statistics.ts';
import type { CorrectError, Corrector } from './corrector.ts';
import { deriveMarks } from './derive.ts';
import type { DeriveOptions } from './derive.ts';

export interface CorrectPageInput {
  readonly lines: readonly string[];
  readonly bboxes?: readonly (Bbox | undefined)[];
  readonly profile: CorrectionProfile;
  readonly corrector: Corrector;
  readonly signal?: AbortSignal;
  readonly maxChangedRun?: DeriveOptions['maxChangedRun'];
}

export type CorrectPageResult =
  | {
      readonly ok: true;
      readonly transcript: Transcript;
      readonly statistics: Statistics;
      readonly correctedText: string;
    }
  | { readonly ok: false; readonly error: CorrectError };

function normalizeLine(line: string): string {
  return line.replaceAll(/\s+/gu, ' ').trim();
}

function failed(message: string): CorrectPageResult {
  return { ok: false, error: { kind: 'failed', message } };
}

export async function correctPage(input: CorrectPageInput): Promise<CorrectPageResult> {
  const { profile, corrector, bboxes } = input;
  const lines = input.lines.map(normalizeLine);
  const signal = input.signal ?? new AbortController().signal;

  const answer = lines.some((line) => line !== '')
    ? await corrector.correct(lines, profile, signal)
    : { ok: true as const, correctedText: lines.join('\n') };
  if (!answer.ok) return answer;

  const derived = deriveMarks(lines, answer.correctedText, {
    profile,
    maxChangedRun: input.maxChangedRun,
  });
  const transcript: Transcript = {
    lines: derived.map((line, index) => {
      const bbox = bboxes?.[index];
      return bbox === undefined ? line : { ...line, bbox };
    }),
  };

  const checked = transcriptSchema.safeParse(transcript);
  if (!checked.success) return failed(checked.error.issues[0]?.message ?? 'Ungültiges Ergebnis');

  const source: Transcript = {
    lines: transcript.lines.map((line) => ({ ...line, marks: [] })),
  };
  const reparsed = parseTranscript(serializeTranscript(transcript), { profile, source });
  if (!reparsed.ok) return failed(formatIssues(reparsed.issues));
  if (serializeTranscript(reparsed.transcript) !== serializeTranscript(transcript)) {
    return failed('Die Markierungen überstehen das Speichern nicht unverändert');
  }

  return {
    ok: true,
    transcript,
    statistics: computeStatistics(transcript),
    correctedText: answer.correctedText,
  };
}
