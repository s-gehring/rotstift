import type { LanguageCode } from '../annotations/catalog.ts';
import { align } from './align.ts';
import type { Op } from './align.ts';
import { tokenizeCorrected, tokenizeLines } from './tokens.ts';
import type { CorrectedToken, OriginalToken } from './tokens.ts';

export const MAX_LOWERED_SHARE = 0.25;

const SENTENCE_END = new Set(['.', '!', '?']);

const ADJECTIVE_ENDINGS = ['', 'e', 'en', 'er', 'es', 'em'];
const NOUN_ENDINGS = ['', 'e', 'n', 'en', 's', 'es'];
const DEFINITE = new Set([
  'der',
  'die',
  'das',
  'dem',
  'den',
  'des',
  'am',
  'im',
  'beim',
  'vom',
  'zum',
  'zur',
  'ins',
  'ans',
]);

const PROPER_NAMES = [
  'erst weltkrieg',
  'zweit weltkrieg',
  'kalt krieg',
  'dreißigjährig krieg',
  'siebenjährig krieg',
  'hundertjährig krieg',
  'westfälisch friede',
  'französisch revolution',
  'heilig römisch reich',
  'dritt reich',
  'norddeutsch bund',
  'wiener kongress',
  'weimarer republik',
  'deutsch demokratisch republik',
  'rot armee',
  'eisern vorhang',
  'schwarz meer',
  'rot meer',
  'tot meer',
  'gelb meer',
  'weiß meer',
  'kaspisch meer',
  'mittelländisch meer',
  'still ozean',
  'indisch ozean',
  'atlantisch ozean',
  'pazifisch ozean',
  'arktisch ozean',
  'mittler osten',
  'fern osten',
  'wild westen',
  'bayerisch wald',
  'thüringer wald',
  'schwäbisch alb',
  'fränkisch alb',
  'sächsisch schweiz',
  'fränkisch schweiz',
  'holsteinisch schweiz',
  'mecklenburgisch seenplatte',
  'lüneburger heide',
  'ostfriesisch insel',
  'nordfriesisch insel',
  'kanarisch insel',
  'britisch insel',
  'hoh tauern',
  'groß barriereriff',
  'chinesisch mauer',
  'kölner dom',
  'brandenburger tor',
  'vereinigt staaten',
  'vereinigt königreich',
  'vereinigt arabisch emirat',
  'tschechisch republik',
  'dominikanisch republik',
  'europäisch union',
  'europäisch parlament',
  'europäisch kommission',
  'europäisch zentralbank',
  'vereint nationen',
  'deutsch bundestag',
  'deutsch bahn',
  'deutsch rot kreuz',
  'rot kreuz',
  'rot halbmond',
  'technisch hilfswerk',
  'alt pinakothek',
  'neu pinakothek',
  'neu nationalgalerie',
  'olympisch spiel',
  'paralympisch spiel',
  'heilig abend',
  'heilig geist',
  'heilig drei könig',
  'heilig schrift',
  'jüngst gericht',
  'letzt abendmahl',
  'alt testament',
  'neu testament',
  'weiß sonntag',
].map((name) => name.split(' '));

const CAPITALISED_PHRASES = [
  ...PROPER_NAMES,
  ...[
    'deutsch reich',
    'deutsch bund',
    'deutsch einheit',
    'neu welt',
    'alt welt',
    'schwarz tod',
    'nah osten',
    'groß seen',
    'rot platz',
    'weiß haus',
    'schief turm',
    'groß wagen',
    'klein wagen',
    'groß bär',
    'klein bär',
    'deutsch post',
    'deutsch museum',
    'freiwillig feuerwehr',
    'alt oper',
    'neu rathaus',
    'alt rathaus',
    'frei universität',
    'heilig nacht',
    'heilig land',
    'gelobt land',
    'erst hilfe',
    'schwarz brett',
    'schwarz peter',
    'gelb seit',
    'gelb karte',
    'rot karte',
    'rund tisch',
  ].map((name) => name.split(' ')),
];

export interface Lowering {
  readonly original: string;
  readonly corrected: CorrectedToken;
  readonly sentenceStart: boolean;
  readonly inName: boolean;
  readonly beforeCapital: boolean;
}

export interface CapitalsCheck {
  readonly capitalized: number;
  readonly lowered: readonly Lowering[];
  readonly collapsed: boolean;
}

function isUpper(char: string): boolean {
  return char !== char.toLowerCase() && char === char.toUpperCase();
}

function lowers(o: OriginalToken, c: CorrectedToken): boolean {
  const first = o.text.charAt(0);
  const replaced = c.text.charAt(0);
  return isUpper(first) && replaced !== first && replaced.toUpperCase() === first;
}

function inflects(word: string, stem: string, endings: readonly string[]): boolean {
  const lower = word.toLowerCase();
  return lower.startsWith(stem) && endings.includes(lower.slice(stem.length));
}

function nameStart(
  names: readonly (readonly string[])[],
  words: readonly string[],
  index: number,
): number | null {
  for (const name of names) {
    for (let position = 0; position < name.length - 1; position += 1) {
      const start = index - position;
      const matches = name.every((part, offset) => {
        const word = words[start + offset];
        const noun = offset === name.length - 1;
        return (
          word !== undefined &&
          (!noun || isUpper(word.charAt(0))) &&
          inflects(word, part, noun ? NOUN_ENDINGS : ADJECTIVE_ENDINGS)
        );
      });
      if (matches) return start;
    }
  }
  return null;
}

function keptCapitals(ops: readonly Op[]): boolean[] {
  return ops.flatMap((op) => {
    if (op.type === 'ins') return [];
    return [op.type !== 'del' && op.o.kind === 'word' && isUpper(op.c.text.charAt(0))];
  });
}

export function checkCapitals(ops: readonly Op[], language: LanguageCode): CapitalsCheck {
  const originals = ops.flatMap((op) => (op.type === 'ins' ? [] : [op.o]));
  const kept = keptCapitals(ops);
  const words = originals.map((token) => token.text);
  const lowered: Lowering[] = [];
  let capitalized = 0;
  let index = -1;
  for (const op of ops) {
    if (op.type === 'ins') continue;
    index += 1;
    const { o } = op;
    const previous = originals[index - 1];
    const sentenceStart = previous === undefined || SENTENCE_END.has(previous.text);
    if (o.kind !== 'word' || !isUpper(o.text.charAt(0))) continue;
    if (!sentenceStart) capitalized += 1;
    if (op.type === 'sub' && op.c.kind === 'word' && lowers(o, op.c)) {
      const inName =
        language === 'de' &&
        !sentenceStart &&
        nameStart(CAPITALISED_PHRASES, words, index) !== null;
      const beforeCapital = kept[index + 1] === true;
      lowered.push({ original: o.text, corrected: op.c, sentenceStart, inName, beforeCapital });
    }
  }
  const midSentence = lowered.filter(
    (lowering) => !lowering.sentenceStart && !lowering.inName && !lowering.beforeCapital,
  ).length;
  const collapsed =
    lowered.some((lowering) => lowering.sentenceStart) ||
    (language === 'de' && midSentence > 1 && midSentence > MAX_LOWERED_SHARE * capitalized);
  return { capitalized, lowered, collapsed };
}

function lowercaseNames(ops: readonly Op[]): CorrectedToken[] {
  const originals = ops.flatMap((op) => (op.type === 'ins' ? [] : [op.o]));
  const words = originals.map((token) => token.text);
  const raised: CorrectedToken[] = [];
  let index = -1;
  for (const op of ops) {
    if (op.type === 'ins') continue;
    index += 1;
    if (op.type !== 'match' || op.o.kind !== 'word' || isUpper(op.o.text.charAt(0))) continue;
    const start = nameStart(PROPER_NAMES, words, index);
    if (start !== null && DEFINITE.has(words[start - 1]?.toLowerCase() ?? '')) raised.push(op.c);
  }
  return raised;
}

function replaceFirst(text: string, token: CorrectedToken, char: string): string {
  return text.slice(0, token.start) + char + text.slice(token.start + 1);
}

export function keepCapitals(
  lines: readonly string[],
  joined: string,
  language: LanguageCode,
): string {
  const ops = align(tokenizeLines(lines).flat(), tokenizeCorrected(joined));
  const { lowered, collapsed } = checkCapitals(ops, language);
  let result = joined;
  for (const { original, corrected, inName } of lowered) {
    if (collapsed || inName) result = replaceFirst(result, corrected, original.charAt(0));
  }
  if (language === 'de') {
    for (const token of lowercaseNames(ops)) {
      result = replaceFirst(result, token, token.text.charAt(0).toUpperCase());
    }
  }
  return result;
}
