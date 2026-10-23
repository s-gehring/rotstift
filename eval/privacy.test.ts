import { describe, expect, it } from 'vitest';
import { locate, parseAnswer } from './privacy-llm.ts';
import { leaks, scoreWork, transferGold } from './privacy-metrics.ts';
import { namesFromWorkName, propagate, ruleSpans, textWords } from './privacy-rules.ts';
import { parseBody, parseSample } from './privacy-sample.ts';
import type { PrivacySpan } from './privacy-sample.ts';

const identifier = (line: number, offset: number, length: number): PrivacySpan => ({
  line,
  offset,
  length,
  kind: 'identifier',
  category: 'person',
  source: 'model',
});

describe('parseBody', () => {
  it('splits a marked name across a line break into two spans of one occurrence', () => {
    const { lines, gold } = parseBody('mit [Ma-\nrek]{person} und [Oma\nist krank]{health}');
    expect(lines).toEqual(['mit Ma-', 'rek und Oma', 'ist krank']);
    expect(gold).toEqual([
      { line: 1, offset: 4, length: 3, category: 'person', occurrence: 0 },
      { line: 2, offset: 0, length: 3, category: 'person', occurrence: 0 },
      { line: 2, offset: 8, length: 3, category: 'health', occurrence: 1 },
      { line: 3, offset: 0, length: 9, category: 'health', occurrence: 1 },
    ]);
  });

  it('reads nested marks and the header', () => {
    const sample = parseSample(
      'p',
      'arbeit: Mia S. 7b.pdf\nklasse: 7\naufgabe: Brief an Clara\n---\n[[Leo]{person} hat Asthma]{health}',
    );
    expect(sample.workName).toBe('Mia S. 7b.pdf');
    expect(sample.task).toBe('Brief an Clara');
    expect(sample.gold.map((span) => span.category)).toEqual(['person', 'health']);
  });
});

describe('scoreWork', () => {
  const { lines, gold } = parseBody(
    '[Leo]{person}s Hund und [Goethe]{keep}\nwohnt in [Ma-\nrek]{person}',
  );

  it('counts an occurrence as found only when every letter is covered', () => {
    const partial = scoreWork(lines, gold, [identifier(1, 0, 3), identifier(2, 9, 2)]);
    expect(partial.identifiers.map((occurrence) => occurrence.found)).toEqual([true, false]);
    expect(leaks(partial)).toBe(1);
    const full = scoreWork(lines, gold, [
      identifier(1, 0, 4),
      identifier(2, 9, 3),
      identifier(3, 0, 3),
    ]);
    expect(leaks(full)).toBe(0);
    expect(full.overWords).toEqual([]);
  });

  it('reports replaced figures and redacted ordinary words', () => {
    const score = scoreWork(lines, gold, [identifier(1, 5, 4), identifier(1, 14, 6)]);
    expect(score.overWords).toEqual(['Hund', 'Goethe']);
    expect(score.keep).toEqual([{ text: 'Goethe', replaced: true }]);
  });
});

describe('transferGold', () => {
  it('moves spans onto a misread transcript with other line breaks', () => {
    const { lines, gold } = parseBody(
      'Gestern war [Jonas]{person} da.\nEr wohnt in [Bornheim]{place}.',
    );
    const read = ['Gestern war Jcnas da. Er', 'wohnt in Bomheim.'];
    const moved = transferGold(lines, gold, read);
    expect(
      moved.map((span) => read[span.line - 1]?.slice(span.offset, span.offset + span.length)),
    ).toEqual(['Jcnas', 'Bomheim']);
  });
});

describe('locate', () => {
  it('finds every occurrence of a quote, with genitive and across a hyphenated line break', () => {
    const lines = ['Leo und Leos Freundin Emma Kö-', 'nig, Leonie nicht'];
    const spans = locate(lines, [
      { quote: 'Leo', category: 'person', kind: 'identifier' },
      { quote: 'Emma König', category: 'person', kind: 'identifier' },
    ]);
    expect(
      spans.map((span) => lines[span.line - 1]?.slice(span.offset, span.offset + span.length)),
    ).toEqual(['Leo', 'Leo', 'Emma Kö', 'nig']);
  });

  it('falls back to a close match when the model corrects the spelling', () => {
    const spans = locate(
      ['ich und Kewin'],
      [{ quote: 'Kevin', category: 'person', kind: 'identifier' }],
    );
    expect(spans).toMatchObject([{ line: 1, offset: 8, length: 5 }]);
  });

  it('parses the structured answer', () => {
    expect(
      parseAnswer(
        '{"kennungen":[{"zitat":"Mia","kategorie":"Person"}],"sensibel":[{"zitat":"Asthma","kategorie":"Gesundheit"}]}',
      ),
    ).toEqual([
      { quote: 'Mia', category: 'person', kind: 'identifier' },
      { quote: 'Asthma', category: 'health', kind: 'sensitive' },
    ]);
  });
});

describe('rules', () => {
  it('takes names from the file name and matches them loosely', () => {
    expect(namesFromWorkName('schulz_mia_7b_aufsatz.pdf')).toEqual(['schulz', 'mia']);
    const lines = [
      'Ich bin Mia Schultz, Mias Mail ist mia@web.de',
      'Tel. 0171 2238491, am 3.5.2012',
    ];
    const spans = ruleSpans(
      lines,
      { workName: 'Schulz Mia.pdf', language: 'Deutsch' },
      {
        firstNames: false,
        triggers: true,
        fuzzy: true,
      },
    );
    const texts = spans.map((span) =>
      lines[span.line - 1]?.slice(span.offset, span.offset + span.length),
    );
    expect(texts).toEqual(
      expect.arrayContaining(['Mia', 'Schultz', 'Mias', 'mia@web.de', '0171 2238491', '3.5.2012']),
    );
  });

  it('propagates a found name to its other occurrences', () => {
    const lines = ['Frau Winter kam.', 'Frau winters Auto'];
    const spans = propagate(lines, [identifier(1, 5, 6)], false);
    expect(
      spans.map((span) => lines[span.line - 1]?.slice(span.offset, span.offset + span.length)),
    ).toEqual(['Winter', 'Winter', 'winters']);
  });
});

describe('textWords', () => {
  it('joins a word hyphenated at the end of a line', () => {
    const words = textWords(['Leos Freund Ma-', 'rek kam, Anne-Sophie auch'], true);
    expect(words.map((entry) => entry.word)).toEqual([
      'Leos',
      'Freund',
      'Marek',
      'kam',
      'Anne-Sophie',
      'auch',
    ]);
    expect(words[2]?.parts).toEqual([
      { line: 1, offset: 12, length: 3 },
      { line: 2, offset: 0, length: 3 },
    ]);
  });
});
