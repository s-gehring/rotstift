import { describe, expect, it } from 'vitest';
import { lineSchema, listErrors, markSchema, transcriptSchema } from './transcript.ts';
import type { Transcript } from './transcript.ts';

const error = {
  kind: 'error',
  type: 'R',
  original: 'Schwimbad',
  correction: 'Schwimmbad',
  offset: 11,
} as const;

function messages(result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}): string[] {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

describe('markSchema', () => {
  it('accepts an error and an omission', () => {
    expect(markSchema.safeParse(error).success).toBe(true);
    expect(
      markSchema.safeParse({
        kind: 'omission',
        type: 'Z',
        original: '',
        correction: ',',
        offset: 3,
      }).success,
    ).toBe(true);
  });

  it('rejects an error without original text', () => {
    const result = markSchema.safeParse({ ...error, original: '' });
    expect(messages(result)).toContain('Ein Fehler braucht einen Originaltext.');
  });

  it('rejects a correction identical to the original', () => {
    const result = markSchema.safeParse({ ...error, correction: 'Schwimbad' });
    expect(messages(result)).toContain('Die Korrektur ist identisch mit dem Originaltext.');
  });

  it('allows an empty correction for a superfluous word', () => {
    expect(markSchema.safeParse({ ...error, correction: '' }).success).toBe(true);
  });

  it('rejects an omission with original text or without missing text', () => {
    const withOriginal = markSchema.safeParse({
      ...error,
      kind: 'omission' as const,
      correction: ',',
    });
    expect(messages(withOriginal)).toContain('Eine Auslassung hat keinen Originaltext.');
    const withoutFix = markSchema.safeParse({
      ...error,
      kind: 'omission',
      original: '',
      correction: '',
    });
    expect(messages(withoutFix)).toContain('Eine Auslassung braucht den fehlenden Text.');
  });

  it('rejects an empty type and a negative offset', () => {
    expect(markSchema.safeParse({ ...error, type: '' }).success).toBe(false);
    expect(markSchema.safeParse({ ...error, offset: -1 }).success).toBe(false);
  });
});

describe('lineSchema', () => {
  const line = { number: 1, text: 'Am Samstag Schwimbad.', marks: [error] };

  it('accepts a consistent line with an optional bounding box', () => {
    expect(lineSchema.safeParse(line).success).toBe(true);
    const withBox = { ...line, bbox: { x: 10, y: 20, width: 300, height: 40 } };
    expect(lineSchema.safeParse(withBox).success).toBe(true);
  });

  it('rejects a mark whose original text does not match the line text', () => {
    const result = lineSchema.safeParse({ ...line, marks: [{ ...error, offset: 0 }] });
    expect(messages(result)[0]).toContain('liegt nicht an Position 0');
  });

  it('rejects a mark beyond the end of the line', () => {
    const result = lineSchema.safeParse({ ...line, marks: [{ ...error, offset: 15 }] });
    expect(result.success).toBe(false);
  });

  it('rejects overlapping marks', () => {
    const overlapping = { ...error, original: 'wimbad', correction: 'x', offset: 14 };
    const result = lineSchema.safeParse({ ...line, marks: [error, overlapping] });
    expect(messages(result)[0]).toContain('überlappt');
  });

  it('rejects marks that are not sorted by position', () => {
    const early = {
      kind: 'omission' as const,
      type: 'Z',
      original: '',
      correction: ',',
      offset: 2,
    };
    expect(lineSchema.safeParse({ ...line, marks: [error, early] }).success).toBe(false);
  });

  it('allows an omission directly before and after an error', () => {
    const before = {
      kind: 'omission' as const,
      type: 'Z',
      original: '',
      correction: ',',
      offset: 11,
    };
    const after = {
      kind: 'omission' as const,
      type: 'Z',
      original: '',
      correction: '.',
      offset: 20,
    };
    expect(lineSchema.safeParse({ ...line, marks: [before, error, after] }).success).toBe(true);
  });

  it('rejects a degenerate bounding box', () => {
    const result = lineSchema.safeParse({ ...line, bbox: { x: 0, y: 0, width: 0, height: 10 } });
    expect(messages(result)).toContain('Die Breite der Bounding Box muss größer als 0 sein.');
  });
});

describe('transcriptSchema', () => {
  it('requires ascending line numbers', () => {
    const lines = [
      { number: 2, text: 'a', marks: [] },
      { number: 2, text: 'b', marks: [] },
    ];
    const result = transcriptSchema.safeParse({ lines });
    expect(messages(result)[0]).toContain('müssen aufsteigen');
  });

  it('accepts gaps in the line numbering', () => {
    const lines = [
      { number: 1, text: 'a', marks: [] },
      { number: 4, text: 'b', marks: [] },
    ];
    expect(transcriptSchema.safeParse({ lines }).success).toBe(true);
  });
});

describe('listErrors', () => {
  it('flattens marks with their line number in reading order', () => {
    const transcript: Transcript = {
      lines: [
        {
          number: 1,
          text: 'ab cd',
          marks: [{ ...error, original: 'ab', correction: 'AB', offset: 0 }],
        },
        { number: 2, text: 'ef', marks: [] },
        {
          number: 3,
          text: 'gh',
          marks: [{ kind: 'omission', type: 'Z', original: '', correction: ',', offset: 2 }],
        },
      ],
    };
    expect(listErrors(transcript).map((e) => [e.line, e.kind, e.offset])).toEqual([
      [1, 'error', 0],
      [3, 'omission', 2],
    ]);
  });
});
