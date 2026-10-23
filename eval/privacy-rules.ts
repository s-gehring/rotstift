import { FIRST_NAMES } from './privacy-names.ts';
import { isIdentifier } from './privacy-sample.ts';
import type { DetectorContext, IdentifierCategory, PrivacySpan } from './privacy-sample.ts';

const MONTHS =
  'januar|jänner|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mär|apr|jun|jul|aug|sep|sept|okt|nov|dez';

const PATTERNS: { category: IdentifierCategory; pattern: RegExp }[] = [
  { category: 'contact', pattern: /[\w.+-]+\s?@\s?[\w-]+(?:\.[\w-]+)+/giu },
  { category: 'contact', pattern: /\b(?:https?:\/\/|www\.)\S+/giu },
  { category: 'contact', pattern: /(?<![\w.])@[\w.]{2,}/gu },
  { category: 'contact', pattern: /(?:\+|\b0)\d[\d /-]{5,}\d/gu },
  { category: 'number', pattern: /\b[A-Z]{2}\d{2}(?:\s?[\dA-Z]{2,4}){3,8}\b/gu },
  { category: 'number', pattern: /\b\d[\d -]{4,}\d\b/gu },
  { category: 'number', pattern: /\b[A-ZÄÖÜ]{1,3}[- ][A-Z]{1,2} ?\d{1,4}[EH]?\b/gu },
  { category: 'place', pattern: /\b\d{5}(?:\s+[A-ZÄÖÜ][\p{L}-]+)?/gu },
  {
    category: 'place',
    pattern:
      /\b[\p{L}-]*(?:straße|strasse|str\.|weg|allee|platz|gasse|ring|damm|ufer|chaussee|pfad|steig|höhe|hof)(?:\s+\d+\s?[a-z]?\b)?/giu,
  },
  {
    category: 'place',
    pattern:
      /\b(?:Am|An der|An den|Im|In der|Auf dem|Auf der|Zum|Zur)\s+[A-ZÄÖÜ][\p{L}-]+\s+\d+\s?[a-z]?\b/gu,
  },
  { category: 'date', pattern: /\b\d{1,2}\.\s?\d{1,2}\.(?:\s?\d{2,4})?/gu },
  {
    category: 'date',
    pattern: new RegExp(`\\b\\d{1,2}\\.?\\s+(?:${MONTHS})\\.?(?:\\s+\\d{4})?`, 'giu'),
  },
  {
    category: 'institution',
    pattern:
      /\b[\p{L}-]+-(?:schule|gymnasium|realschule|gesamtschule|grundschule|oberschule|kita|kindergarten|klinik|krankenhaus|praxis)\b/giu,
  },
  {
    category: 'institution',
    pattern:
      /\b(?:Gymnasium|Realschule|Gesamtschule|Grundschule|Oberschule|Hauptschule|Mittelschule|Stadtteilschule|Schule|Kita|Kindergarten)\s+(?:(?:am|an der|im|in der|auf der|zum|zur)\s+)?[A-ZÄÖÜ][\p{L}-]+/gu,
  },
  {
    category: 'institution',
    pattern:
      /\b(?:1\.\s?)?(?:TSV|SV|FC|SC|TuS|VfL|VfB|SpVgg|TSG|DJK|SG|BSC|TV|ESV|FSV|JSG|HSG|TTC|RSV|SSV|BV|Rot-Weiß|Blau-Weiß|Eintracht|Borussia|Fortuna)\s+[A-ZÄÖÜ\d][\p{L}\d-]*(?:\s+\d{2,4})?/gu,
  },
];

const TRIGGERS =
  /\b(?:Frau|Herr|Herrn|Fr\.|Hr\.|heiße|heisse|heißt|heist|Name ist|nennen mich|genannt|Oma|Opa|Onkel|Tante|Cousin|Cousine|Bruder|Schwester|Freund|Freundin|Kumpel|Nachbar|Nachbarin|Mitschüler|Mitschülerin|Banknachbar|Banknachbarin|Liebe|Lieber|Hallo|Hi|Hey|Servus|Moin|Deine|Dein|Euer|Eure|Grüße|Gruß)\s+([A-ZÄÖÜa-zäöüß][\p{L}-]*)/gu;

const NOT_NAMES = new Set(
  `oma opa mama papa mutter vater eltern familie frau herr leute klasse grüße gruß tagebuch freund freundin
  schule lehrer lehrerin mitschüler mitschülerin bruder schwester tante onkel ist war hat und aber der die das
  dem den ein eine einer mal mir mich dich dir euch uns ganz sehr so auch noch nicht doch nur schon immer`
    .split(/\s+/u)
    .filter(Boolean),
);

const FILE_WORDS = new Set(
  `aufsatz brief scan img image seite page klassenarbeit ka erörterung eroerterung inhaltsangabe bericht tagebuch
  test deutsch final kopie version neu steckbrief vorstellung erzählung erzaehlung erlebniserzählung hausaufgabe
  ha klasse pdf jpg jpeg png heic arbeit nachschreiben entwurf mathe englisch geschichte gruppe dokument document
  foto photo bild korrektur abgabe text teil unbenannt neues lernkontrolle schulaufgabe übung uebung
  erlebnis praktikum praktikumsbericht unfallbericht email mail tagebucheintrag reinschrift`
    .split(/\s+/u)
    .filter(Boolean),
);

export function namesFromWorkName(workName: string): string[] {
  return workName
    .replace(/\.[a-z0-9]{2,4}$/iu, '')
    .split(/[^\p{L}]+/u)
    .filter((part) => part.length >= 3 && !FILE_WORDS.has(part.toLowerCase()));
}

export function normalizeName(word: string): string {
  return word
    .toLowerCase()
    .replace(/['’`´]s?$/u, '')
    .replace(/[^\p{L}]/gu, '');
}

export function distance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0] ?? 0;
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j] ?? 0;
      previous[j] = Math.min(
        above + 1,
        (previous[j - 1] ?? 0) + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length] ?? 0;
}

export function nameMatches(word: string, name: string, fuzzy: boolean): boolean {
  const a = normalizeName(word);
  const b = normalizeName(name);
  if (a === '' || b === '') return false;
  if (a === b || (a.endsWith('s') && a.slice(0, -1) === b)) return true;
  if (!fuzzy || b.length < 5 || a[0] !== b[0]) return false;
  return distance(a, b) <= 1 || (a.endsWith('s') && distance(a.slice(0, -1), b) <= 1);
}

function span(
  line: number,
  offset: number,
  length: number,
  category: IdentifierCategory,
  source: PrivacySpan['source'],
): PrivacySpan {
  return { line, offset, length, kind: 'identifier', category, source };
}

interface TextWord {
  word: string;
  parts: { line: number; offset: number; length: number }[];
}

export function textWords(lines: readonly string[], hyphenInWord: boolean): TextWord[] {
  const pattern = hyphenInWord ? /[\p{L}][\p{L}'’-]*-?/gu : /[\p{L}][\p{L}'’]*-?/gu;
  const words: TextWord[] = [];
  let carry: TextWord | undefined;
  lines.forEach((text, index) => {
    const matches = [...text.matchAll(pattern)];
    matches.forEach((match, position) => {
      const raw = match[0];
      const part = { line: index + 1, offset: match.index, length: raw.length };
      if (carry && position === 0 && text.slice(0, match.index).trim() === '') {
        words.push({ word: carry.word + raw.replace(/-$/u, ''), parts: [...carry.parts, part] });
        carry = undefined;
        return;
      }
      if (carry) words.push(carry);
      carry = undefined;
      const atEnd =
        position === matches.length - 1 && text.slice(match.index + raw.length).trim() === '';
      const entry = { word: raw.replace(/-$/u, ''), parts: [part] };
      if (raw.endsWith('-') && atEnd) carry = entry;
      else words.push(entry);
    });
  });
  if (carry) words.push(carry);
  return words;
}

function wordSpans(entry: TextWord, category: IdentifierCategory, source: PrivacySpan['source']) {
  return entry.parts.map((part) => span(part.line, part.offset, part.length, category, source));
}

export interface RuleOptions {
  firstNames: boolean;
  triggers: boolean;
  fuzzy: boolean;
}

export function ruleSpans(
  lines: readonly string[],
  context: DetectorContext,
  options: RuleOptions,
): PrivacySpan[] {
  const spans: PrivacySpan[] = [];
  const known = namesFromWorkName(context.workName);
  const firstNames = options.firstNames ? FIRST_NAMES : [];
  const taskWords = new Set(
    (context.task ?? '')
      .split(/[^\p{L}]+/u)
      .filter((word) => /^\p{Lu}/u.test(word))
      .map(normalizeName),
  );
  lines.forEach((text, index) => {
    const line = index + 1;
    for (const { category, pattern } of PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        spans.push(span(line, match.index, match[0].trimEnd().length, category, 'rule'));
      }
    }
    if (options.triggers) {
      for (const match of text.matchAll(TRIGGERS)) {
        const name = match[1] ?? '';
        if (NOT_NAMES.has(name.toLowerCase()) || taskWords.has(normalizeName(name))) continue;
        if (!/^\p{Lu}/u.test(name) && !/^(?:heiße|heisse|heißt|heist|Name ist)/u.test(match[0]))
          continue;
        spans.push(
          span(line, match.index + match[0].length - name.length, name.length, 'person', 'rule'),
        );
      }
    }
  });
  for (const entry of textWords(lines, true)) {
    const word = entry.word;
    if (taskWords.has(normalizeName(word))) continue;
    const fromWork = known.some((name) => nameMatches(word, name, options.fuzzy));
    const fromList =
      !fromWork &&
      firstNames.some(
        (name) => (name.length >= 4 || /^\p{Lu}/u.test(word)) && nameMatches(word, name, false),
      );
    if (fromWork || fromList) spans.push(...wordSpans(entry, 'person', 'name-list'));
  }
  return spans;
}

const GENERIC = new Set(
  `schule gymnasium realschule gesamtschule grundschule oberschule hauptschule verein straße strasse weg platz
  allee gasse kita kindergarten praxis klinik krankenhaus frau herr herrn der die das dem den des am an im in
  auf zum zur und von bei mit`
    .split(/\s+/u)
    .filter(Boolean),
);

export function propagate(
  lines: readonly string[],
  spans: readonly PrivacySpan[],
  fuzzy: boolean,
): PrivacySpan[] {
  const tokens = new Map<string, IdentifierCategory>();
  for (const entry of spans) {
    const category = entry.category;
    if (entry.kind !== 'identifier' || !isIdentifier(category)) continue;
    if (['contact', 'number', 'date'].includes(category)) continue;
    const text = lines[entry.line - 1]?.slice(entry.offset, entry.offset + entry.length) ?? '';
    for (const token of text.split(/[^\p{L}'’-]+/u)) {
      const word = token.replace(/-$/u, '');
      const minimum = category === 'person' ? 2 : 4;
      if (word.length < minimum || GENERIC.has(word.toLowerCase())) continue;
      tokens.set(word, category);
    }
  }
  const added: PrivacySpan[] = [];
  for (const entry of textWords(lines, true)) {
    for (const [token, category] of tokens) {
      if (nameMatches(entry.word, token, fuzzy)) {
        added.push(...wordSpans(entry, category, 'rule'));
        break;
      }
    }
  }
  return [...spans, ...added];
}

export function wordForms(word: string): string[] {
  const bare = word.replace(/['’]s?$/u, '');
  const forms = [
    bare,
    bare.toLowerCase(),
    bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase(),
  ];
  if (bare.endsWith('s')) forms.push(bare.slice(0, -1));
  return [...new Set(forms)];
}

export function candidateWords(lines: readonly string[]): string[] {
  return textWords(lines, false)
    .map((entry) => entry.word)
    .filter((word) => word.length >= 3);
}

export function dictionarySpans(
  lines: readonly string[],
  context: DetectorContext,
  isWord: (word: string) => boolean,
  capitalizedOnly: boolean,
): PrivacySpan[] {
  const taskWords = new Set((context.task ?? '').split(/[^\p{L}]+/u).map(normalizeName));
  const spans: PrivacySpan[] = [];
  for (const entry of textWords(lines, false)) {
    const word = entry.word;
    if (word.length < 3 || taskWords.has(normalizeName(word))) continue;
    if (capitalizedOnly && !/^\p{Lu}/u.test(word)) continue;
    if (wordForms(word).some(isWord)) continue;
    spans.push(...wordSpans(entry, 'person', 'rule'));
  }
  return spans;
}
