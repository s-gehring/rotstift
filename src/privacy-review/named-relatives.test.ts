import { describe, expect, it } from 'vitest';
import { createDictionaryDetector, type UnknownWords } from '../privacy/dictionary.ts';
import { createModelDetector } from '../privacy/model-detector.ts';
import { createNamesDetector } from '../privacy/names.ts';
import type { DetectorContext, PrivacySpan } from '../privacy/types.ts';
import { createDetectWork, DETECTORS } from './detect.ts';

const RELATIONS: readonly (readonly [string, string])[] = [
  ['Vater', 'Mein'],
  ['Mutter', 'Meine'],
  ['Papa', 'Mein'],
  ['Mama', 'Meine'],
  ['Opa', 'Mein'],
  ['Oma', 'Meine'],
  ['Onkel', 'Mein'],
  ['Tante', 'Meine'],
  ['Bruder', 'Mein'],
  ['Schwester', 'Meine'],
  ['Cousin', 'Mein'],
  ['Cousine', 'Meine'],
  ['Freund', 'Mein'],
  ['Freundin', 'Meine'],
  ['Nachbar', 'Mein'],
  ['Nachbarin', 'Meine'],
  ['Trainer', 'Mein'],
  ['Lehrer', 'Mein'],
  ['Lehrerin', 'Meine'],
];

const UNLISTED: readonly (readonly [string, string])[] = [
  ['Wolfhart', 'Wolfbart'],
  ['Swanhild', 'Swanhlld'],
];

const OLDER_NAMES: readonly (readonly [string, string])[] = [
  ['Rüdiger', 'Rudiger'],
  ['Burkhard', 'Burkbard'],
  ['Gisela', 'Gisla'],
  ['Hannelore', 'Hannclore'],
  ['Detlef', 'Detlet'],
  ['Waltraud', 'Waltrand'],
];

const KNOWN = new Set([...UNLISTED, ...OLDER_NAMES].map(([name]) => name));

const unknownWords: UnknownWords = async (words) =>
  new Set(words.filter((word) => !KNOWN.has(word)));

const context: DetectorContext = { workName: 'Erlebnis.pdf', language: 'de' };
const signal = new AbortController().signal;

async function detect(line: string, quote: string): Promise<readonly PrivacySpan[]> {
  const work = createDetectWork([
    ...DETECTORS,
    createNamesDetector(unknownWords),
    createDictionaryDetector(unknownWords),
    createModelDetector({
      models: ['m'],
      sensitiveModel: 'm',
      unknownWords,
      ask: async () =>
        JSON.stringify({ kennungen: [{ zitat: quote, kategorie: 'Person' }], sensibel: [] }),
    }),
  ]);
  const pages = await work([{ pageId: 'p', lines: [line] }], context, signal);
  return pages[0]?.spans ?? [];
}

function covered(line: string, word: string, spans: readonly PrivacySpan[]): boolean {
  const start = line.indexOf(word);
  return Array.from({ length: word.length }, (_, index) => start + index).every((at) =>
    spans.some(
      (span) =>
        span.kind === 'identifier' &&
        span.category === 'person' &&
        at >= span.offset &&
        at < span.offset + span.length,
    ),
  );
}

describe('names after a relation word that the dictionary knows', () => {
  for (const [relation, possessive] of RELATIONS) {
    for (const [name, misread] of UNLISTED) {
      for (const spelling of [name, misread]) {
        for (const line of [
          `${possessive} ${relation} ${spelling} arbeitet bei VW.`,
          `Gestern kam ${relation} ${spelling} zu Besuch.`,
        ]) {
          it(`stay replaced: ${line}`, async () => {
            expect(covered(line, spelling, await detect(line, spelling))).toBe(true);
          });
        }
      }
    }
  }
});

describe('older German first names that the dictionary knows', () => {
  for (const [name, misread] of OLDER_NAMES) {
    for (const spelling of [name, misread]) {
      for (const line of [
        `Mein Vater ${spelling} arbeitet bei VW.`,
        `Gestern hat ${spelling} angerufen.`,
      ]) {
        it(`stay replaced: ${line}`, async () => {
          expect(covered(line, spelling, await detect(line, spelling))).toBe(true);
        });
      }
    }
  }
});
