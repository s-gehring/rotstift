import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffAnswer, diffMessages } from './correct-diff.ts';
import { goldFromMarkup } from './gold.ts';
import { scorePage } from './mark-metrics.ts';
import { DEUTSCH } from '../src/annotations/profile.ts';

const textsDir = join(import.meta.dirname, 'samples', 'texts');
const markups = readdirSync(textsDir)
  .filter((name) => name.endsWith('.txt'))
  .map((name) => readFileSync(join(textsDir, name), 'utf8').trim());

function numbered(corrected: string): string {
  return corrected
    .split('\n')
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n');
}

describe('diffMessages', () => {
  it('numbers the lines and fills in the subject', () => {
    const { input } = goldFromMarkup('Der Hunt bellt. Er {iss|ist|R} da.', 20);
    const [system, user] = diffMessages(DEUTSCH, input, 'spec');
    expect(system?.content).toContain('Fach: Deutsch.');
    expect(user?.content).toBe(
      input.lines.map((line) => `${line.number}: ${line.text}`).join('\n'),
    );
  });
});

describe('diffAnswer', () => {
  it('reports lines missing in the answer', () => {
    const { input } = goldFromMarkup('Eins zwei drei vier fünf sechs sieben.', 12);
    const result = diffAnswer(input, '1: Eins zwei');
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('counts a rewording as one collapsed run', () => {
    const { input } = goldFromMarkup('Der alte Mann geht in die Stadt und kauft ein Brot.', 80);
    const result = diffAnswer(input, '1: Ein älterer Herr ging in die Stadt und kaufte ein Brot.');
    expect(result.collapsed).toBe(1);
  });
});

describe('perfect corrections of the sample texts', () => {
  it('find every grammar error as grammar', () => {
    let gold = 0;
    let matched = 0;
    for (const markup of markups) {
      const { input, gold: goldTranscript, corrected } = goldFromMarkup(markup);
      const { transcript } = diffAnswer(input, numbered(corrected));
      const score = scorePage(input, goldTranscript, transcript);
      gold += score.typeTotals['G']?.gold ?? 0;
      matched += score.typeTotals['G']?.matched ?? 0;
    }
    expect(gold).toBe(6);
    expect(matched).toBe(6);
  });

  it('locate every error, with one spelling error typed as grammar', () => {
    let gold = 0;
    let located = 0;
    let wrongType = 0;
    for (const markup of markups) {
      const { input, gold: goldTranscript, corrected } = goldFromMarkup(markup);
      const { transcript } = diffAnswer(input, numbered(corrected));
      const score = scorePage(input, goldTranscript, transcript);
      expect(score.predicted).toBe(score.matched + score.wrongType);
      gold += score.gold;
      located += score.matched + score.wrongType;
      wrongType += score.wrongType;
    }
    expect(located).toBe(gold);
    expect(wrongType).toBe(1);
  });

  it('add no marks to texts without errors', () => {
    for (const markup of markups) {
      const clean = goldFromMarkup(markup.replaceAll(/\{[^{}|]*\|([^{}|]*)\|[A-Za-z]+\}/g, '$1'));
      const { transcript } = diffAnswer(clean.input, numbered(clean.corrected));
      expect(transcript.lines.flatMap((line) => line.marks)).toEqual([]);
    }
  });
});
