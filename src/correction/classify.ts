import type { LanguageCode } from '../annotations/catalog.ts';
import { isSimilar } from './edit-distance.ts';
import type { MarkRole } from './kinds.ts';

interface Morphology {
  endings: ReadonlySet<string>;
  paradigms: readonly (readonly string[])[];
}

const POSSESSIVES = ['mein', 'dein', 'sein', 'ihr', 'unser', 'euer'];
const POSSESSIVE_ENDINGS = ['', 'e', 'en', 'em', 'er', 'es'];

const GERMAN: Morphology = {
  endings: new Set([
    '',
    'e',
    'en',
    'er',
    'es',
    'em',
    'n',
    's',
    't',
    'st',
    'te',
    'ten',
    'et',
    'est',
  ]),
  paradigms: [
    ['der', 'die', 'das', 'dem', 'den', 'des'],
    ['ein', 'eine', 'einen', 'einem', 'einer', 'eines'],
    ['kein', 'keine', 'keinen', 'keinem', 'keiner', 'keines'],
    ...POSSESSIVES.map((stem) => POSSESSIVE_ENDINGS.map((ending) => stem + ending)),
    ['ich', 'mich', 'mir'],
    ['du', 'dich', 'dir'],
    ['er', 'ihn', 'ihm'],
    ['es', 'ihm'],
    ['sie', 'ihr', 'ihnen'],
    ['wir', 'uns'],
    ['ihr', 'euch'],
    ['bin', 'bist', 'ist', 'sind', 'seid', 'sei', 'seist', 'seien', 'war', 'warst', 'waren'],
    ['wäre', 'wärst', 'wären', 'gewesen'],
    ['habe', 'hast', 'hat', 'haben', 'habt', 'hatte', 'hattest', 'hatten', 'hätte', 'hätten'],
    ['werde', 'wirst', 'wird', 'werden', 'werdet', 'wurde', 'wurden', 'würde', 'würden'],
  ],
};

const ENGLISH: Morphology = {
  endings: new Set(['', 's', 'es', 'ed', 'd', 'ing', 'er', 'est', 'ly', 'ies', 'ied', 'en']),
  paradigms: [
    ['i', 'me', 'my', 'mine'],
    ['you', 'your', 'yours'],
    ['he', 'him', 'his'],
    ['she', 'her', 'hers'],
    ['it', 'its'],
    ['we', 'us', 'our', 'ours'],
    ['they', 'them', 'their', 'theirs'],
    ['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being'],
    ['have', 'has', 'had', 'having'],
    ['do', 'does', 'did', 'done'],
  ],
};

const MORPHOLOGY: Record<LanguageCode, Morphology> = { de: GERMAN, en: ENGLISH };

const MIN_STEM = 4;
const MAX_ENDING = 3;

function commonPrefix(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
  return length;
}

function sameParadigm(a: string, b: string, paradigms: Morphology['paradigms']): boolean {
  return paradigms.some((forms) => forms.includes(a) && forms.includes(b));
}

function isInflection(a: string, b: string, morphology: Morphology): boolean {
  const stem = commonPrefix(a, b);
  const endingA = a.slice(stem);
  const endingB = b.slice(stem);
  return (
    stem >= MIN_STEM &&
    endingA.length <= MAX_ENDING &&
    endingB.length <= MAX_ENDING &&
    morphology.endings.has(endingA) &&
    morphology.endings.has(endingB)
  );
}

export function classifyWordChange(
  original: string,
  correction: string,
  language: LanguageCode,
): MarkRole {
  const a = original.toLowerCase();
  const b = correction.toLowerCase();
  if (a === b) return 'spelling';
  const morphology = MORPHOLOGY[language];
  if (sameParadigm(a, b, morphology.paradigms) || isInflection(a, b, morphology)) {
    return 'grammar';
  }
  return isSimilar(a, b) ? 'spelling' : 'wording';
}
