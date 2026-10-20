import { describe, expect, it } from 'vitest';
import type { Mark, Transcript } from '../annotations/transcript.ts';
import type { ReadingHint } from '../correction/uncertain-reading.ts';
import { layoutHints, markText } from './hint-layout.ts';
import type { TextLocator } from './locator.ts';

const charLocator: TextLocator = {
  span: (line, start, end) => ({
    x0: (line.bbox?.x ?? 0) + start * 10,
    x1: (line.bbox?.x ?? 0) + end * 10,
  }),
};

const transcript: Transcript = {
  lines: [
    {
      number: 1,
      text: 'Er kam spt heim',
      bbox: { x: 100, y: 50, width: 150, height: 40 },
      marks: [],
    },
    { number: 2, text: 'ohne Box', marks: [] },
  ],
};

const hint = (line: number, mark: Mark, status: ReadingHint['status'] = 'open'): ReadingHint => ({
  line,
  mark,
  confidence: 0.5,
  status,
});

const error = (offset: number, original: string, correction: string): Mark => ({
  kind: 'error',
  type: 'R',
  original,
  correction,
  offset,
});

describe('layoutHints', () => {
  it('underlines the whole word of an error and the word before a missing sign', () => {
    const spots = layoutHints(
      transcript,
      [
        hint(1, error(8, 'p', 'pä')),
        hint(1, { kind: 'omission', type: 'Z', original: '', correction: ',', offset: 6 }),
        hint(1, error(11, 'heim', 'Heim'), 'dismissed'),
        hint(2, error(0, 'ohne', 'Ohne')),
      ],
      charLocator,
    );
    expect(spots.map((spot) => [spot.index, spot.x, spot.width])).toEqual([
      [0, 170, 30],
      [1, 130, 30],
    ]);
    expect(spots[0]).toMatchObject({ y: 50, height: 40, status: 'open' });
    expect(spots[0]?.underline).toBeCloseTo(50 + 40 * 0.92);
  });

  it('describes the suggestion like the mark list', () => {
    expect(markText(error(0, 'spt', 'spät'))).toBe('„spt“ → „spät“');
    expect(markText(error(0, 'und', ''))).toBe('„und“ streichen');
    expect(
      markText({ kind: 'omission', type: 'Z', original: '', correction: ',', offset: 2 }),
    ).toBe('fehlt: „,“');
  });
});
