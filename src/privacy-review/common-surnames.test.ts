import { describe, expect, it } from 'vitest';
import { createDictionaryDetector, type UnknownWords } from '../privacy/dictionary.ts';
import { createModelDetector } from '../privacy/model-detector.ts';
import { createNamesDetector } from '../privacy/names.ts';
import type { DetectorContext, PrivacySpan } from '../privacy/types.ts';
import { createDetectWork, DETECTORS } from './detect.ts';

const SURNAMES: readonly (readonly [string, string])[] = [
  ['Schneider', 'Schnelder'],
  ['Fischer', 'Fiscber'],
  ['Richter', 'Rlchter'],
  ['Neumann', 'Neumarn'],
  ['Schäfer', 'Schafer'],
  ['Lehmann', 'Lehrnann'],
  ['Hoffmann', 'Hoffrnann'],
  ['Hartmann', 'Hartrnann'],
  ['Zimmermann', 'Zimmerrnann'],
  ['Schwarz', 'Schwarx'],
  ['Krüger', 'Krugcr'],
  ['Schröder', 'Schroder'],
];

const plural = (name: string) => (name.endsWith('z') ? name : `${name}s`);

const FORMS: readonly (readonly [string, (name: string) => string, (name: string) => string])[] = [
  ['after Frau', (name) => `Gestern war Frau ${name} im Garten.`, (name) => name],
  ['after Herr', (name) => `Herr ${name} kam zu spät.`, (name) => name],
  ['after a first name', (name) => `Tim ${name} spielt Fußball.`, (name) => name],
  ['after Familie', (name) => `Familie ${name} wohnt nebenan.`, (name) => name],
  ['as a family plural', (name) => `Wir waren bei ${plural(name)} zum Essen.`, plural],
  ['in a letter greeting', (name) => `Liebe Frau ${name},`, (name) => name],
];

const KNOWN = new Set(
  SURNAMES.flatMap(([name]) => [name, plural(name), name.toLocaleLowerCase('de')]),
);

const unknownWords: UnknownWords = async (words) =>
  new Set(words.filter((word) => !KNOWN.has(word)));

const context: DetectorContext = { workName: 'Brief.pdf', language: 'de' };
const signal = new AbortController().signal;

function detect(line: string, quote: string): Promise<readonly PrivacySpan[]> {
  const model = createModelDetector({
    models: ['m'],
    sensitiveModel: 'm',
    unknownWords,
    ask: async () =>
      JSON.stringify({ kennungen: [{ zitat: quote, kategorie: 'Person' }], sensibel: [] }),
  });
  const work = createDetectWork([
    ...DETECTORS,
    createNamesDetector(unknownWords),
    createDictionaryDetector(unknownWords),
    model,
  ]);
  return work([{ pageId: 'p', lines: [line] }], context, signal).then(
    (pages) => pages[0]?.spans ?? [],
  );
}

function covered(line: string, word: string, spans: readonly PrivacySpan[]): boolean {
  const start = line.indexOf(word);
  return Array.from({ length: word.length }, (_, index) => index).every((index) =>
    spans.some(
      (span) =>
        span.kind === 'identifier' &&
        span.category === 'person' &&
        start + index >= span.offset &&
        start + index < span.offset + span.length,
    ),
  );
}

describe('common surnames that are also dictionary words', () => {
  for (const [label, sentence, occurrence] of FORMS) {
    for (const [name, misread] of SURNAMES) {
      for (const spelling of [name, misread]) {
        it(`stay replaced ${label}: ${spelling}`, async () => {
          const line = sentence(spelling);
          const word = occurrence(spelling);
          expect(covered(line, word, await detect(line, word))).toBe(true);
        });
      }
    }
  }
});
