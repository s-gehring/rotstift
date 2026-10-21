import { formatIssues, parseTranscript } from '../annotations/parse.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';
import {
  readStruck,
  visibleLine,
  type StruckLine,
  type VisibleLine,
} from '../annotations/struck.ts';
import { serializeTranscript } from '../annotations/serialize.ts';
import { transcriptSchema } from '../annotations/transcript.ts';
import type { Bbox, Mark, Transcript, TranscriptLine } from '../annotations/transcript.ts';
import { computeStatistics } from '../stats/statistics.ts';
import type { Statistics } from '../stats/statistics.ts';
import type { CorrectError, Corrector } from './corrector.ts';
import { deriveMarksDetailed } from './derive.ts';
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
      readonly droppedMarks: number;
    }
  | { readonly ok: false; readonly error: CorrectError };

function normalizeLine(line: string): string {
  return line.replaceAll(/\s+/gu, ' ').trim();
}

function restoreMark(mark: Mark, read: StruckLine, visible: VisibleLine): Mark | null {
  const { positions } = visible;
  if (mark.kind === 'omission') {
    const offset = mark.offset > 0 ? (positions[mark.offset - 1] ?? 0) + 1 : (positions[0] ?? 0);
    return { ...mark, offset };
  }
  const start = positions[mark.offset];
  const last = positions[mark.offset + mark.original.length - 1];
  if (start === undefined || last === undefined) return null;
  if (read.text.slice(start, last + 1) !== mark.original) return null;
  return { ...mark, offset: start };
}

function restoreLine(line: TranscriptLine, read: StruckLine, visible: VisibleLine) {
  if (read.struck.length === 0) return { line, dropped: 0 };
  const marks = line.marks.flatMap((mark) => restoreMark(mark, read, visible) ?? []);
  return {
    line: { ...line, text: read.text, marks, struck: read.struck },
    dropped: line.marks.length - marks.length,
  };
}

const INVALID_MESSAGE = 'Die Korrekturmarkierungen konnten nicht erstellt werden';

function invalid(detail: string): CorrectPageResult {
  return { ok: false, error: { kind: 'failed', message: INVALID_MESSAGE, detail } };
}

export async function correctPage(input: CorrectPageInput): Promise<CorrectPageResult> {
  const { profile, corrector, bboxes } = input;
  const read = input.lines.map((line) => readStruck(normalizeLine(line)));
  const visible = read.map((line) => visibleLine(line.text, line.struck));
  const lines = visible.map((line) => line.text);
  const signal = input.signal ?? new AbortController().signal;

  const answer = lines.some((line) => line !== '')
    ? await corrector.correct(lines, profile, signal)
    : { ok: true as const, correctedText: lines.join('\n') };
  if (!answer.ok) return answer;

  const derived = deriveMarksDetailed(lines, answer.correctedText, {
    profile,
    maxChangedRun: input.maxChangedRun,
  });
  const restored = derived.lines.map((line, index) =>
    restoreLine(
      line,
      read[index] ?? { text: line.text, struck: [] },
      visible[index] ?? { text: line.text, positions: [] },
    ),
  );
  const transcript: Transcript = {
    lines: restored.map(({ line }, index) => {
      const bbox = bboxes?.[index];
      return bbox === undefined ? line : { ...line, bbox };
    }),
  };

  const checked = transcriptSchema.safeParse(transcript);
  if (!checked.success) return invalid(checked.error.issues[0]?.message ?? 'Ungültiges Ergebnis');

  const source: Transcript = {
    lines: transcript.lines.map((line) => ({ ...line, marks: [] })),
  };
  const reparsed = parseTranscript(serializeTranscript(transcript), { profile, source });
  if (!reparsed.ok) return invalid(formatIssues(reparsed.issues));
  if (serializeTranscript(reparsed.transcript) !== serializeTranscript(transcript)) {
    return invalid('Die Markierungen überstehen das Speichern nicht unverändert');
  }

  return {
    ok: true,
    transcript,
    statistics: computeStatistics(transcript),
    correctedText: answer.correctedText,
    droppedMarks: derived.droppedOverlaps + restored.reduce((sum, { dropped }) => sum + dropped, 0),
  };
}
