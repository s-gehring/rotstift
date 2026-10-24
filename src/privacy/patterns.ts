import { editDistance } from '../correction/edit-distance.ts';
import { COMMON_WORDS } from './common-words.ts';
import { buildSearchText, mergeRanges, toSpans, type CategorizedRange } from './search-text.ts';
import type { Detector, IdentifierCategory, IdentifierSpan } from './types.ts';

const MONTHS =
  'januar|jänner|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mär|apr|jun|jul|aug|sep|sept|okt|nov|dez';

const SCHOOLS =
  'Gymnasium|Realschule|Gesamtschule|Grundschule|Oberschule|Hauptschule|Mittelschule|Stadtteilschule|Schule|Kita|Kindergarten';

const PRACTICES = String.raw`\p{L}*(?:[Pp]raxis|[Kk]anzlei|[Aa]potheke|[Kk]linik(?:um)?|[Kk]rankenhaus)`;

const NAMED_PLACE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])\p{L}*(?:[Ff]riedhof|[Aa]utohaus|[Rr]eiterhof|[Ss]portplatz|[Ff]reibad|[Hh]allenbad|[Ss]tadion|[Bb]äckerei|[Mm]etzgerei|[Gg]ärtnerei|[Aa]potheke|[Pp]izzeria|[Hh]otel)\s+(\p{Lu}[\p{L}-]+)`,
  'gu',
);

const SCHOOL_WORDS = [
  'gesamtschule',
  'realschule',
  'grundschule',
  'hauptschule',
  'oberschule',
  'mittelschule',
  'förderschule',
  'sekundarschule',
  'gemeinschaftsschule',
  'stadtteilschule',
  'gymnasium',
];

const CLUBS =
  'TSV|SV|FC|SC|TuS|VfL|VfB|SpVgg|TSG|DJK|SG|BSC|TV|ESV|FSV|JSG|HSG|TTC|RSV|SSV|BV|Rot-Weiß|Blau-Weiß|Eintracht|Borussia|Fortuna';

interface Pattern {
  readonly category: IdentifierCategory;
  readonly pattern: RegExp;
  readonly accept?: (match: RegExpExecArray) => boolean;
}

function validDate(match: RegExpExecArray): boolean {
  const day = Number(match.groups?.['d']);
  const month = Number(match.groups?.['m']);
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

const PATTERNS: readonly Pattern[] = [
  {
    category: 'place',
    pattern:
      /(?<![\p{L}\p{N}])\p{Lu}[\p{L}-]*(?:straße|strasse|str\.|weg|allee|gasse|damm|ufer|chaussee|pfad|steig)(?:\s\d{1,4}\s?[a-z]?(?![\p{L}\p{N}]))?/gu,
  },
  {
    category: 'date',
    pattern:
      /(?<![\p{N}.])(?<d>\d{1,2})\.\s?(?<m>\d{1,2})\.(?:\s?\d[\dOoIl]{3,4}(?![\p{L}\p{N}])|\s?\d{4}|\s?\d{2}(?!\d))?/gu,
    accept: validDate,
  },
  {
    category: 'date',
    pattern: /(?<![\p{N}.])(?<d>\d{2})(?<m>\d{2})\.\d{4}(?!\d)/gu,
    accept: validDate,
  },
  {
    category: 'date',
    pattern: new RegExp(
      String.raw`(?<![\p{N}])\d{1,2}\.?\s+(?:${MONTHS})(?![\p{L}])\.?(?:\s+\d{4})?`,
      'giu',
    ),
  },
  {
    category: 'institution',
    pattern:
      /(?<![\p{L}\p{N}])[\p{L}-]+-(?:schule|gymnasium|realschule|gesamtschule|grundschule|oberschule|kita|kindergarten|klinik|krankenhaus|praxis)(?![\p{L}\p{N}])/giu,
  },
  {
    category: 'institution',
    pattern: new RegExp(
      String.raw`(?<![\p{L}\p{N}])(?:${SCHOOLS})\s+(?:(?:am|an der|im|in der|auf der|zum|zur)\s+)?\p{Lu}[\p{L}-]+`,
      'gu',
    ),
  },
  {
    category: 'institution',
    pattern: new RegExp(
      String.raw`(?<![\p{L}\p{N}])(?:1\.\s?)?(?:${CLUBS})\s+[\p{Lu}\d][\p{L}\d-]*(?:\s+\d{2,4})?`,
      'gu',
    ),
  },
  {
    category: 'institution',
    pattern:
      /(?<![\p{L}\p{N}])(?:Kirchengemeinde|Pfarrgemeinde|Gemeinde|Pfarrei|Kirche)\s+(?:St\.|Sankt|Hl\.|Heilig(?:e|er|en)?)\s?\p{Lu}[\p{L}-]+/gu,
  },
  {
    category: 'institution',
    pattern: /(?<![\p{L}\p{N}])\p{Ll}{0,2}\p{Lu}[\p{L}-]*\s+(?:St\.|Sankt)\s?\p{Lu}[\p{L}-]+/gu,
  },
  {
    category: 'institution',
    pattern: new RegExp(
      String.raw`(?<![\p{L}\p{N}])${PRACTICES}\s+(?:Dr|Prof)\.?\s?(?:med\.\s?)?\p{Lu}[\p{L}-]+`,
      'gu',
    ),
  },
  {
    category: 'institution',
    pattern:
      /(?<![\p{L}\p{N}])(?:\p{Lu}[\p{L}&.-]*\s+){1,3}(?:gGmbH|GmbH|mbH|KG|OHG|UG|GbR|e\.\s?V\.)(?![\p{L}])/gu,
  },
  { category: 'number', pattern: /(?<![\p{L}\p{N}])\d[\d -]{4,}\d(?![\p{L}\p{N}])/gu },
  {
    category: 'number',
    pattern: /(?<![\p{L}\p{N}])[A-ZÄÖÜ]{1,3}[- ][A-Z]{1,2} ?\d{1,4}[EH]?(?![\p{L}\p{N}])/gu,
  },
];

export function findPatternSpans(lines: readonly string[]): IdentifierSpan[] {
  const search = buildSearchText(lines);
  const ranges: CategorizedRange[] = [];
  for (const { category, pattern, accept } of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of search.text.matchAll(pattern)) {
      if (accept !== undefined && !accept(match)) continue;
      const value = match[0].trimEnd();
      ranges.push({ start: match.index, end: match.index + value.length, category });
    }
  }
  for (const match of search.text.matchAll(NAMED_PLACE)) {
    if (COMMON_WORDS.has((match[1] ?? '').toLocaleLowerCase('de'))) continue;
    ranges.push({ start: match.index, end: match.index + match[0].length, category: 'place' });
  }
  for (const match of search.text.matchAll(
    /(?<![\p{L}\p{N}])(\p{Lu}\p{L}{6,})\s+\p{Lu}[\p{L}-]+/gu,
  )) {
    const word = (match[1] ?? '').toLocaleLowerCase('de');
    if (SCHOOL_WORDS.some((school) => editDistance(word, school) <= 2)) {
      ranges.push({
        start: match.index,
        end: match.index + match[0].length,
        category: 'institution',
      });
    }
  }
  return mergeRanges(ranges).flatMap((range) => toSpans(search, range, 'rule'));
}

export const detectPatterns: Detector = async (lines, _context, signal) => {
  signal.throwIfAborted();
  return findPatternSpans(lines);
};
