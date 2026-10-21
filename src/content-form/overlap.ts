import type { CorrectionProfile } from '../annotations/profile.ts';
import type { Transcript } from '../annotations/transcript.ts';
import { codeFor, type MarkRole } from '../correction/kinds.ts';

export type CoverRole = MarkRole | 'tense';

export const COMMENT_COVERS: Readonly<Record<string, readonly CoverRole[]>> = {
  'Präsens verwenden': ['tense'],
  'Präteritum verwenden': ['tense'],
  'Zeitform wechselt': ['tense'],
  'Sachlich im Präsens beschreiben': ['tense'],
  'Sie-Form verwenden': ['grammar', 'wording'],
  'Anrede nicht förmlich': ['wording'],
  'Grußformel nicht förmlich': ['wording'],
  'Wertung, bitte sachlich': ['wording'],
  'Keine persönliche Wertung': ['wording'],
};

const TENSE_CODE = 'T';

export function coveringCodes(comment: string, profile: CorrectionProfile): string[] {
  return (COMMENT_COVERS[comment] ?? []).flatMap((role) => {
    if (role !== 'tense') return codeFor(profile, role) ?? [];
    return profile.allowedTypes.includes(TENSE_CODE) ? [TENSE_CODE] : [];
  });
}

export function coveringMark(
  comment: { readonly line: number; readonly text: string },
  transcript: Transcript,
  profile: CorrectionProfile,
): string | null {
  const codes = new Set(coveringCodes(comment.text, profile));
  if (codes.size === 0) return null;
  const line = transcript.lines.find((candidate) => candidate.number === comment.line);
  return line?.marks.find((mark) => codes.has(mark.type))?.type ?? null;
}
