import { describe, expect, it } from 'vitest';
import { DEUTSCH, ENGLISCH, SACHFACH } from '../annotations/profile.ts';
import type { Transcript } from '../annotations/transcript.ts';
import { TEXT_FORMS } from './catalog.ts';
import { COMMENT_COVERS, coveringCodes, coveringMark } from './overlap.ts';

const transcript: Transcript = {
  lines: [
    { number: 1, text: 'Ciao Herr Meier,', marks: [] },
    {
      number: 2,
      text: 'gestern ging ich in die Stadt.',
      marks: [
        {
          kind: 'error',
          type: 'T',
          original: 'ging',
          correction: 'gehe',
          offset: 8,
        },
      ],
    },
    {
      number: 3,
      text: 'Ciao, dein Tim',
      marks: [{ kind: 'error', type: 'A', original: 'Ciao', correction: 'Viele Grüße', offset: 0 }],
    },
  ],
};

describe('comment covers', () => {
  it('only lists fixed comments of the catalogue', () => {
    const comments = new Set(
      TEXT_FORMS.flatMap((form) => form.features.map((feature) => feature.comment)),
    );
    expect(Object.keys(COMMENT_COVERS).filter((comment) => !comments.has(comment))).toEqual([]);
  });

  it('resolves roles to the codes of the profile', () => {
    expect(coveringCodes('Präsens verwenden', DEUTSCH)).toEqual(['T']);
    expect(coveringCodes('Präsens verwenden', SACHFACH)).toEqual([]);
    expect(coveringCodes('Grußformel nicht förmlich', DEUTSCH)).toEqual(['A']);
    expect(coveringCodes('Grußformel nicht förmlich', ENGLISCH)).toEqual(['voc']);
    expect(coveringCodes('Sie-Form verwenden', DEUTSCH)).toEqual(['G', 'A']);
    expect(coveringCodes('Ort und Datum fehlen', DEUTSCH)).toEqual([]);
    expect(coveringCodes('Thema verfehlt', DEUTSCH)).toEqual([]);
  });

  it('finds a covering mark only on the same line', () => {
    expect(coveringMark({ line: 2, text: 'Präsens verwenden' }, transcript, DEUTSCH)).toBe('T');
    expect(coveringMark({ line: 1, text: 'Präsens verwenden' }, transcript, DEUTSCH)).toBeNull();
    expect(coveringMark({ line: 3, text: 'Grußformel nicht förmlich' }, transcript, DEUTSCH)).toBe(
      'A',
    );
    expect(coveringMark({ line: 3, text: 'Präsens verwenden' }, transcript, DEUTSCH)).toBeNull();
    expect(coveringMark({ line: 2, text: 'Präsens verwenden' }, transcript, SACHFACH)).toBeNull();
  });
});
