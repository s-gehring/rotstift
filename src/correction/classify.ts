import type { LanguageCode } from '../annotations/catalog.ts';
import { isSimilar } from './edit-distance.ts';
import type { MarkRole } from './kinds.ts';

interface Morphology {
  endings: ReadonlySet<string>;
  paradigms: readonly (readonly string[])[];
  minStem?: number;
  maxEnding?: number;
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

const FRENCH: Morphology = {
  minStem: 3,
  maxEnding: 6,
  endings: new Set([
    '',
    'e',
    's',
    'es',
    'x',
    't',
    'nt',
    'ent',
    'er',
    'ez',
    'é',
    'ée',
    'és',
    'ées',
    'i',
    'is',
    'it',
    'u',
    'ue',
    'us',
    'ons',
    'ais',
    'ait',
    'aient',
    'ions',
    'iez',
    'a',
    'ai',
    'as',
    'ont',
    'ant',
    'ra',
    'rait',
    'ront',
    'erai',
    'erons',
    'eux',
    'euse',
    'al',
    'aux',
  ]),
  paradigms: [
    ['le', 'la', 'les'],
    ['un', 'une', 'des'],
    ['ce', 'cet', 'cette', 'ces'],
    ['mon', 'ma', 'mes'],
    ['ton', 'ta', 'tes'],
    ['son', 'sa', 'ses'],
    ['notre', 'nos'],
    ['votre', 'vos'],
    ['leur', 'leurs'],
    ['il', 'elle', 'ils', 'elles'],
    ['me', 'moi'],
    ['te', 'toi'],
    ['lui', 'leur'],
    [
      'suis',
      'es',
      'est',
      'sommes',
      'êtes',
      'sont',
      'étais',
      'était',
      'étions',
      'étaient',
      'ai',
      'as',
      'a',
      'avons',
      'avez',
      'ont',
      'avais',
      'avait',
      'avions',
      'avaient',
    ],
    ['vais', 'vas', 'va', 'allons', 'allez', 'vont'],
    ['fais', 'fait', 'faisons', 'faites', 'font'],
    ['à', 'de', 'en', 'dans', 'sur', 'pour', 'par', 'avec', 'sans', 'chez', 'vers'],
  ],
};

const SPANISH: Morphology = {
  minStem: 3,
  maxEnding: 6,
  endings: new Set([
    '',
    'o',
    'a',
    'os',
    'as',
    'e',
    'es',
    'en',
    'an',
    'ó',
    'é',
    'í',
    'ía',
    'ían',
    'aba',
    'aban',
    'ábamos',
    'aron',
    'ieron',
    'ado',
    'ido',
    'ando',
    'iendo',
    'ar',
    'er',
    'ir',
    's',
    'n',
    'mos',
    'amos',
    'emos',
    'imos',
    'áis',
    'éis',
    'ás',
    'és',
    'ste',
    'aste',
    'iste',
    'ra',
    'ras',
    'ran',
    'ría',
    'rá',
    'rán',
  ]),
  paradigms: [
    ['el', 'la', 'los', 'las'],
    ['un', 'una', 'unos', 'unas'],
    ['este', 'esta', 'estos', 'estas'],
    ['ese', 'esa', 'esos', 'esas'],
    ['mi', 'mis'],
    ['tu', 'tus'],
    ['su', 'sus'],
    ['nuestro', 'nuestra', 'nuestros', 'nuestras'],
    ['me', 'te', 'se', 'nos', 'os'],
    ['lo', 'la', 'los', 'las', 'le', 'les'],
    [
      'soy',
      'eres',
      'es',
      'somos',
      'sois',
      'son',
      'era',
      'eras',
      'éramos',
      'eran',
      'fui',
      'fue',
      'estoy',
      'estás',
      'está',
      'estamos',
      'estáis',
      'están',
      'estaba',
      'estaban',
    ],
    ['he', 'has', 'ha', 'hemos', 'habéis', 'han', 'había', 'habían'],
    ['voy', 'vas', 'va', 'vamos', 'vais', 'van', 'iba', 'iban'],
    ['a', 'en', 'de', 'por', 'para', 'con', 'sin', 'sobre', 'entre', 'hacia', 'desde', 'hasta'],
  ],
};

const MORPHOLOGY: Record<LanguageCode, Morphology> = {
  de: GERMAN,
  en: ENGLISH,
  fr: FRENCH,
  es: SPANISH,
};

const DEFAULT_MIN_STEM = 4;
const DEFAULT_MAX_ENDING = 3;

function withoutAccents(text: string): string {
  return text.normalize('NFD').replaceAll(/\p{M}/gu, '');
}

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
  const maxEnding = morphology.maxEnding ?? DEFAULT_MAX_ENDING;
  return (
    stem >= (morphology.minStem ?? DEFAULT_MIN_STEM) &&
    endingA.length <= maxEnding &&
    endingB.length <= maxEnding &&
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
  if (sameParadigm(a, b, morphology.paradigms)) return 'grammar';
  if (withoutAccents(a) === withoutAccents(b)) return 'spelling';
  if (isInflection(a, b, morphology)) return 'grammar';
  return isSimilar(a, b) ? 'spelling' : 'wording';
}
