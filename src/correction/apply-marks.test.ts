import { describe, expect, it } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import type { TranscriptLine } from '../annotations/transcript.ts';
import { at } from './at.ts';
import { deriveMarksDetailed } from './derive.ts';
import { joinCorrected } from './tokens.ts';

const WORD_END = /[\p{L}\p{N}]$/u;
const WORD_START = /^[\p{L}\p{N}]/u;

function applyMark(text: string, mark: TranscriptLine['marks'][number]): string {
  const before = text.slice(0, mark.offset);
  const after = text.slice(mark.offset + mark.original.length);
  if (mark.kind === 'error') return before + mark.correction + after;
  const lead = WORD_END.test(before) && WORD_START.test(mark.correction) ? ' ' : '';
  const trail = WORD_END.test(mark.correction) && WORD_START.test(after) ? ' ' : '';
  return before + lead + mark.correction + trail + after;
}

function tidy(text: string): string {
  return text.replaceAll(/ ([.,;:!?])/gu, '$1');
}

function applyMarks(lines: readonly TranscriptLine[]): string {
  const applied = lines.map((line) => line.marks.reduceRight(applyMark, line.text));
  return tidy(joinCorrected(applied.join('\n')));
}

function roundTrip(lines: string[], corrected: string, maxChangedRun?: number) {
  const result = deriveMarksDetailed(lines, corrected, { profile: DEUTSCH, maxChangedRun });
  return { applied: applyMarks(result.lines), result };
}

describe('applying the marks reproduces the corrected text', () => {
  it.each([
    [['Wir gingen zur Haus', 'tür und dann'], 'Wir gingen zur Haustür und dann'],
    [['Wir gingen zu', 'sammen nach Hause.'], 'Wir gingen zusammen nach Hause.'],
    [
      ['Ich habe gestern einen', 'Hund gesehen der war groß und', 'braun.'],
      'Gestern sah ich einen großen braunen Hund.',
    ],
    [['Der alte Mann', 'geht in die Stadt.'], 'Ein älterer Herr ging in die Stadt.'],
    [['Er kam und dann ging er', 'wieder weg'], 'Er kam.'],
    [['Die Ru-', 'tche war toll.'], 'Die Rutsche war toll.'],
    [['Wir bauen die Rut-', 'sche weil es', 'regnet.'], 'Wir bauen die Rutsche, weil es regnet.'],
    [['Gestern ich', 'ging nach Hause.'], 'Gestern ging ich nach Hause.'],
    [['Ich habe', 'Hund.'], 'Ich habe einen Hund.'],
  ])('%j', (lines, corrected) => {
    const { applied, result } = roundTrip(lines, corrected);
    expect(result.droppedOverlaps).toBe(0);
    expect(applied).toBe(tidy(joinCorrected(corrected)));
  });

  it('marks the later line of a split word with an empty fix', () => {
    const [first, second] = deriveMarksDetailed(
      ['Wir gingen zur Haus', 'tür und dann'],
      'Wir gingen zur Haustür und dann',
      {
        profile: DEUTSCH,
      },
    ).lines;
    expect(first?.marks).toEqual([
      { kind: 'error', type: 'R', original: 'Haus', correction: 'Haustür', offset: 15 },
    ]);
    expect(second?.marks).toEqual([
      { kind: 'error', type: 'R', original: 'tür', correction: '', offset: 0 },
    ]);
  });

  it('keeps the corrections consistent with random edits across line breaks', () => {
    const base =
      'Letzten Sommer sind wir mit dem Zug an die Ostsee gefahren. Schon am ersten Morgen wollte mein Bruder unbedingt ins Wasser, obwohl es ziemlich kalt war. Ich habe mich zuerst nicht getraut, aber dann bin ich doch hinterhergerannt.';
    const words = base.split(' ');
    let seed = 7;
    const random = (limit: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % limit;
    };
    let dropped = 0;
    let checked = 0;
    for (let round = 0; round < 300; round += 1) {
      const edited = [...words];
      for (let edit = 0; edit < 1 + random(4); edit += 1) {
        const index = random(edited.length);
        const kind = random(4);
        if (kind === 0) edited.splice(index, 1);
        else if (kind === 1) edited[index] = `${at(edited, index)}x`;
        else if (kind === 2) edited.splice(index, 0, 'sehr');
        else edited.splice(index, 2, at(edited, index + 1), at(edited, index));
      }
      const width = 12 + random(30);
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        if (current !== '' && current.length + word.length + 1 > width) {
          lines.push(current);
          current = word;
        } else {
          current = current === '' ? word : `${current} ${word}`;
        }
      }
      lines.push(current);
      const corrected = edited.join(' ');
      const { applied, result } = roundTrip(lines, corrected);
      dropped += result.droppedOverlaps;
      checked += 1;
      expect(applied, `${JSON.stringify(lines)} -> ${corrected}`).toBe(tidy(corrected));
    }
    expect(checked).toBe(300);
    expect(dropped).toBe(0);
  });
});
