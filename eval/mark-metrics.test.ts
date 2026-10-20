import { describe, expect, it } from 'vitest';
import type { Mark, Transcript } from '../src/annotations/transcript.ts';
import { goldFromMarkup, transcriptFromText } from './gold.ts';
import {
  applyMarks,
  linkWords,
  preservedLines,
  remapGold,
  scoreLine,
  scorePage,
} from './mark-metrics.ts';

const text = 'Ich glaube dass der Hunt bellt.';
const comma: Mark = { kind: 'omission', type: 'Z', original: '', correction: ',', offset: 10 };
const hunt: Mark = { kind: 'error', type: 'R', original: 'Hunt', correction: 'Hund', offset: 20 };

describe('applyMarks', () => {
  it('replaces errors and attaches punctuation to the previous word', () => {
    expect(applyMarks(text, [comma, hunt])).toBe('Ich glaube, dass der Hund bellt.');
  });

  it('attaches punctuation even when the mark sits after a space', () => {
    expect(applyMarks(text, [{ ...comma, offset: 11 }])).toBe('Ich glaube, dass der Hunt bellt.');
  });
});

describe('scoreLine', () => {
  it('counts exact marks as strict and correct', () => {
    const result = scoreLine(text, [comma, hunt], [comma, hunt]);
    expect(result).toMatchObject({ strict: 2, matched: 2, wrongType: 0, fixCorrect: 2 });
  });

  it('accepts a comma marked as error on the preceding word', () => {
    const asError: Mark = {
      kind: 'error',
      type: 'Z',
      original: 'glaube',
      correction: 'glaube,',
      offset: 4,
    };
    const result = scoreLine(text, [comma], [asError]);
    expect(result).toMatchObject({ strict: 0, matched: 1, fixCorrect: 1 });
  });

  it('flags a wrong fix on a matched span', () => {
    const wrong: Mark = { ...hunt, correction: 'Hunde' };
    expect(scoreLine(text, [hunt], [wrong])).toMatchObject({ matched: 1, fixCorrect: 0 });
  });

  it('reports a detected error with the wrong type separately', () => {
    const wrong: Mark = { ...hunt, type: 'G' };
    expect(scoreLine(text, [hunt], [wrong])).toMatchObject({ matched: 0, wrongType: 1 });
  });

  it('does not match marks on other words', () => {
    const other: Mark = {
      kind: 'error',
      type: 'R',
      original: 'bellt',
      correction: 'bellt.',
      offset: 25,
    };
    expect(scoreLine(text, [hunt], [other])).toMatchObject({ matched: 0, wrongType: 0 });
  });
});

describe('scorePage', () => {
  const { input, gold } = goldFromMarkup('Ich glaube{|,|Z} dass der {Hunt|Hund|R} bellt.');

  it('counts residual word edits before and after applying the marks', () => {
    const score = scorePage(input, gold, gold);
    expect(score).toMatchObject({
      gold: 2,
      predicted: 2,
      matched: 2,
      residualBefore: 2,
      residualAfter: 0,
    });
  });

  it('treats a rejected answer as no marks', () => {
    expect(scorePage(input, gold)).toMatchObject({ predicted: 0, matched: 0, residualAfter: 2 });
  });
});

describe('preservedLines', () => {
  const input: Transcript = transcriptFromText('Ich glaube dass der Hunt bellt.');

  it('ignores marks and entities when comparing text', () => {
    const output =
      '<rs-line n="1">Ich glaube<rs-missing type="Z" fix=","></rs-missing> dass der <rs-error type="R" fix="Hund">Hunt</rs-error> bellt.</rs-line>';
    expect(preservedLines(input, output)).toBe(1);
  });

  it('detects rewritten text', () => {
    expect(preservedLines(input, '<rs-line n="1">Ich glaube, dass der Hund bellt.</rs-line>')).toBe(
      0,
    );
  });
});

describe('remapGold', () => {
  const { gold } = goldFromMarkup(
    'Wir gehen {zum essen|zum Essen|R} und {fahrn|fahren|R} heim.',
    80,
  );

  it('moves marks onto the OCR lines when the words survive', () => {
    const ocr = transcriptFromText('Wir gehen zum essen und fahrn heim.', 80);
    const result = remapGold(gold, ocr);
    expect(result).toMatchObject({ total: 2, recoverable: 2 });
    expect(result.gold.lines[0]?.marks.map((mark) => mark.original)).toEqual([
      'zum essen',
      'fahrn',
    ]);
  });

  it('drops marks whose words the OCR changed', () => {
    const ocr = transcriptFromText('Wir gehen zum Essen und fahrn heim.', 80);
    expect(remapGold(gold, ocr)).toMatchObject({ total: 2, recoverable: 1 });
  });
});

describe('linkWords', () => {
  it('links equal words across insertions', () => {
    expect(linkWords(['a', 'b', 'c'], ['a', 'x', 'b', 'c'])).toEqual([0, 2, 3]);
  });
});
