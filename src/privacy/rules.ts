import {
  buildSearchText,
  mergeRanges,
  toSpans,
  type CategorizedRange,
  type SearchText,
} from './search-text.ts';
import type { Detector, IdentifierCategory, IdentifierSpan } from './types.ts';

const B = String.raw`(?<![\p{L}\p{N}])`;
const E = String.raw`(?![\p{L}\p{N}])`;

const MONTHS = [
  'Januar',
  'Jänner',
  'Februar',
  'März',
  'Maerz',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
  'Jan\\.',
  'Feb\\.',
  'Mär\\.',
  'Apr\\.',
  'Jun\\.',
  'Jul\\.',
  'Aug\\.',
  'Sept?\\.',
  'Okt\\.',
  'Nov\\.',
  'Dez\\.',
].join('|');

const DOT = String.raw`\s?\.\s?`;
const DAY = String.raw`\d{1,2}`;

const NUMBER_PREFIXES = [
  'konto',
  'kto',
  'kunden',
  'mitglieds',
  'ausweis',
  'personalausweis',
  'schülerausweis',
  'schüler',
  'pass',
  'reisepass',
  'versicherten',
  'versicherungs',
  'sozialversicherungs',
  'renten',
  'steuer',
  'steueridentifikations',
  'matrikel',
  'vertrags',
  'rechnungs',
  'bestell',
  'auftrags',
  'ticket',
  'sendungs',
  'tracking',
  'lizenz',
  'fahrgestell',
  'karten',
  'bibliotheks',
];

function capitalizable(word: string): string {
  const first = word.charAt(0);
  return `[${first}${first.toUpperCase()}]${word.slice(1)}`;
}

const NUMBER_KEYWORDS = [
  `(?:${NUMBER_PREFIXES.map(capitalizable).join('|')})-?(?:[nN]ummer|[nN]r\\.?)`,
  'BLZ',
  'Bankleitzahl',
  'IBAN',
  '[Ss]teuer-?ID',
  '[Ss]chüler-?ID',
  'Aktenzeichen',
  'Kennzeichen',
  'Nummernschild',
  'Kontonr',
].join('|');

const NUMBER_VALUE = String.raw`(?:[A-Za-z]{1,4}[\s-]?)?\d[\dA-Za-z]*(?:[\s\-/.]\d[\dA-Za-z]*)*`;
const KEYWORD_GAP = String.raw`\.?\s?:?\s?(?:(?:ist|lautet|war)\s)?`;

const UNITS = [
  'Euro',
  'EUR',
  'Euros',
  'Cent',
  'Dollar',
  'Punkte?',
  'Meter',
  'Kilometer',
  'Jahren?',
  'Jahre',
  'Stunden',
  'Minuten',
  'Sekunden',
  'Menschen',
  'Einwohner(?:innen)?',
  'Schüler(?:innen)?',
  'Stück',
  'Liter',
  'Gramm',
  'Kilo(?:gramm)?',
  'Tonnen',
  'Mal',
  'Leute',
  'Personen',
  'Besucher',
  'Zuschauer',
  'Fans',
  'Tiere',
  'Kinder',
  'Seiten',
  'Wörter',
  'Bücher',
  'Follower',
  'Likes',
  'Klicks',
].join('|');

const STREET_SUFFIX = `(?:${['[sS]traße', '[sS]trasse', '[sS]tr\\.', '[wW]eg', '[aA]llee', '[pP]latz', '[gG]asse', '[rR]ing', '[dD]amm', '[uU]fer', '[cC]haussee', '[sS]teig', '[pP]fad', '[sS]tieg', '[pP]romenade', '[kK]amp', '[zZ]eile'].join('|')})`;
const STREET_WORD = `(?:${['Straße', 'Strasse', 'Str\\.', 'Weg', 'Allee', 'Platz', 'Gasse', 'Ring', 'Damm', 'Ufer', 'Chaussee', 'Steig', 'Pfad', 'Promenade'].join('|')})`;
const HOUSE_NUMBER = String.raw`\s?\d{1,4}(?:\s?[a-zA-Z](?![\p{L}]))?(?:\s?[-/]\s?\d{1,4}[a-z]?)?(?!\d)`;
const STREET_PREPOSITIONS = [
  'Am',
  'An der',
  'An den',
  'Auf dem',
  'Auf der',
  'Im',
  'In der',
  'In den',
  'Zum',
  'Zur',
  'Unter den',
  'Hinter dem',
  'Hinter der',
  'Vor dem',
  'Alte[rs]?',
  'Neue[rs]?',
  'Große[rs]?',
  'Kleine[rs]?',
].join('|');
const NOT_STREET_NOUNS = [
  'Jahre?n?',
  'Tage?n?',
  'Ende',
  'Anfang',
  'Kapitel',
  'Abschnitt',
  'Absatz',
  'Seite',
  'Zeile',
  'Vers',
  'Akt',
  'Szene',
  'Teil',
  'Punkt',
  'Grad',
  'Prozent',
  'Alter',
  'Monat',
  'Woche',
  'Stunde',
  'Minute',
  'Moment',
  'Mittag',
  'Abend',
  'Morgen',
  'Wochenende',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag',
  'Sommer',
  'Winter',
  'Frühling',
  'Herbst',
  'Unterricht',
  'Spiel',
  'Training',
  'Bus',
  'Zug',
  'Raum',
  'Zimmer',
  'Klasse',
  'Stufe',
  'Runde',
  'Level',
  'Band',
  'Folge',
  'Staffel',
  MONTHS.replaceAll('\\.', ''),
].join('|');

interface Rule {
  readonly category: IdentifierCategory;
  readonly pattern: RegExp;
  readonly accept?: (value: string, match: RegExpExecArray, search: SearchText) => boolean;
}

function rule(category: IdentifierCategory, source: string, accept?: Rule['accept']): Rule {
  return { category, pattern: new RegExp(source, 'gdu'), ...(accept && { accept }) };
}

const digitCount = (text: string) => text.replaceAll(/\D/gu, '').length;

function validDayMonth(day: string, month: string): boolean {
  const d = Number(day);
  const m = Number(month);
  return d >= 1 && d <= 31 && m >= 1 && m <= 12;
}

const BIRTH = /[Gg]eboren|[Gg]eburts?tag|[Gg]eburtsdatum|[Gg]eb\.|[Gg]eburt/u;
const BIRTH_WINDOW = 50;

function nearBirth(match: RegExpExecArray, search: SearchText): boolean {
  const before = search.text.slice(Math.max(0, match.index - BIRTH_WINDOW), match.index);
  const end = match.index + match[0].length;
  const after = search.text.slice(end, end + BIRTH_WINDOW);
  return BIRTH.test(before) || BIRTH.test(after);
}

function letterDate(match: RegExpExecArray, search: SearchText): boolean {
  return /,\s?den\s$/u.test(search.text.slice(Math.max(0, match.index - 8), match.index));
}

function partialDate(match: RegExpExecArray, search: SearchText): boolean {
  return nearBirth(match, search) || letterDate(match, search);
}

const RULES: readonly Rule[] = [
  rule(
    'contact',
    String.raw`[\p{L}\p{N}._%+\-]+\s?(?:@|[(\[{]\s?[aA][tT]\s?[)\]}])\s?[\p{L}\p{N}\-]+(?:(?:\.|\s?\(\s?(?:punkt|dot)\s?\)\s?)[\p{L}\p{N}\-]+)*(?:\.|\s?\(\s?(?:punkt|dot)\s?\)\s?)[a-z]{2,6}${E}`,
  ),
  rule('contact', String.raw`(?:https?:\/\/|www\.)[^\s<>"]*[^\s<>".,;:!?)]`),
  rule(
    'contact',
    String.raw`${B}(?<!@)[\p{L}\p{N}\-]+(?:\.[\p{L}\p{N}\-]+)*\.(?:de|com|net|org|eu|info|io|at|ch|tv|me)(?:\/[^\s<>"]*[^\s<>".,;:!?)])?${E}`,
  ),
  rule('contact', String.raw`(?<![\p{L}\p{N}._%+\-])@[\p{L}\p{N}_.]{1,30}[\p{L}\p{N}_]`),
  rule(
    'contact',
    String.raw`${B}(?:[Tt]el(?:efon)?(?:nummer)?|[Hh]andy(?:nummer)?|[Mm]obil(?:nummer)?|[Ff]ax|WhatsApp)${KEYWORD_GAP}(?<v>\+?\d(?:[\s/\-]{0,2}\d){4,14})(?!\d)`,
  ),
  rule(
    'contact',
    String.raw`(?<![\p{L}\p{N}+])(?:(?:\+|00)\s?\d{1,3}\s?(?:\(0\)\s?)?|\(?0)\d{1,5}\)?(?:[\s/\-]{0,3}\d{1,8}){1,6}(?!\d)`,
    (value) => digitCount(value) >= 7 && digitCount(value) <= 15,
  ),
  rule(
    'number',
    String.raw`${B}(?:[A-Z]{2}|[Dd][Ee])\s?\d{2}(?:\s?[A-Z0-9]){10,30}${E}`,
    (value) => digitCount(value) >= 10,
  ),
  rule(
    'number',
    String.raw`${B}(?:${NUMBER_KEYWORDS})${KEYWORD_GAP}(?<v>${NUMBER_VALUE})`,
    (value) => digitCount(value) >= 3,
  ),
  rule(
    'number',
    String.raw`${B}(?:[Nn]ummer|Nr\.)${KEYWORD_GAP}(?<v>${NUMBER_VALUE})`,
    (value) => digitCount(value) >= 4,
  ),
  rule('number', String.raw`${B}[A-ZÄÖÜ]{1,3}-[A-Z]{1,2}\s?\d{1,4}[EH]?${E}`),
  rule(
    'place',
    String.raw`(?<![\p{L}\p{N}]|\d\s)(?:D-?\s?)?\d(?:\s?\d){4}(?!\s?\d)\s+(?!(?:${UNITS})${E})[A-ZÄÖÜ]\p{L}+(?:-\p{L}+)*(?:\s(?:an der|am|im|in der|bei|ob der|vor der|a\.\s?d\.|i\.\s?d\.)\s[A-ZÄÖÜ]\p{L}+|\s\((?:[A-ZÄÖÜ][\p{L}.]*\s?){1,3}\))?`,
  ),
  rule('place', String.raw`${B}[A-ZÄÖÜ]\p{L}*(?:-\p{L}+)*-?${STREET_SUFFIX}${HOUSE_NUMBER}`),
  rule('place', String.raw`${B}[A-ZÄÖÜ][\p{L}\-]+\s${STREET_WORD}${HOUSE_NUMBER}`),
  rule(
    'place',
    String.raw`${B}(?:${STREET_PREPOSITIONS})\s(?!(?:${NOT_STREET_NOUNS})${E})[A-ZÄÖÜ][\p{L}\-]+\s\d{1,3}(?:\s?[a-z](?![\p{L}]))?(?![\d.,]?\d)`,
  ),
  rule(
    'date',
    String.raw`${B}(?<d>${DAY})${DOT}(?<m>\d{1,2})${DOT}(?:\d{4}|\d{2})(?!\d)`,
    (_value, match) => validDayMonth(match.groups?.d ?? '', match.groups?.m ?? ''),
  ),
  rule('date', String.raw`${B}\d{4}-\d{2}-\d{2}${E}`),
  rule('date', String.raw`${B}(?<d>${DAY})\/(?<m>\d{1,2})\/(?:\d{4}|\d{2})${E}`, (_value, match) =>
    validDayMonth(match.groups?.d ?? '', match.groups?.m ?? ''),
  ),
  rule('date', String.raw`${B}${DAY}\.?\s?(?:${MONTHS})\s?\d{4}${E}`),
  rule(
    'date',
    String.raw`${B}(?<d>${DAY})${DOT}(?<m>\d{1,2})\.(?!\s?\d)`,
    (_value, match, search) =>
      validDayMonth(match.groups?.d ?? '', match.groups?.m ?? '') && partialDate(match, search),
  ),
  rule(
    'date',
    String.raw`${B}${DAY}\.?\s?(?:${MONTHS})(?![\p{L}])(?!\.?\s?\d)`,
    (_value, match, search) => partialDate(match, search),
  ),
  rule('date', String.raw`${B}(?:${MONTHS})\s?\d{4}${E}`, (_value, match, search) =>
    nearBirth(match, search),
  ),
];

function rangesOf(search: SearchText): CategorizedRange[] {
  const ranges: CategorizedRange[] = [];
  for (const { category, pattern, accept } of RULES) {
    pattern.lastIndex = 0;
    for (const match of search.text.matchAll(pattern)) {
      const [start, end] = match.indices?.groups?.['v'] ?? [
        match.index,
        match.index + match[0].length,
      ];
      const value = search.text.slice(start, end).trimEnd();
      if (value === '') continue;
      if (accept !== undefined && !accept(value, match, search)) continue;
      ranges.push({ start, end: start + value.length, category });
    }
  }
  return mergeRanges(ranges);
}

export function findRuleSpans(lines: readonly string[]): IdentifierSpan[] {
  const search = buildSearchText(lines);
  return rangesOf(search).flatMap((range) => toSpans(search, range, 'rule'));
}

export const detectRules: Detector = async (lines, _context, signal) => {
  signal.throwIfAborted();
  return findRuleSpans(lines);
};
