import { editDistance } from '../correction/edit-distance.ts';
import type { UnknownWords } from './dictionary.ts';
import { isFirstName } from './first-names.ts';
import type { ChatMessage, ChatRequest } from '../llm/types.ts';
import type {
  Detector,
  DetectorContext,
  IdentifierCategory,
  PrivacySpan,
  SensitiveCategory,
} from './types.ts';
import { WORD_SURNAMES } from './word-surnames.ts';

const IDENTIFIER_LABELS: Readonly<Record<string, IdentifierCategory>> = {
  Person: 'person',
  Ort: 'place',
  Einrichtung: 'institution',
  Kontakt: 'contact',
  Datum: 'date',
  Nummer: 'number',
};

const SENSITIVE_LABELS: Readonly<Record<string, SensitiveCategory>> = {
  Gesundheit: 'health',
  Herkunft: 'origin',
  Religion: 'religion',
  Politik: 'politics',
  Sexualität: 'sexuality',
  Gewerkschaft: 'union',
  Lebensumstände: 'circumstances',
};

const SYSTEM = `Du schützt die Daten von Schülerinnen und Schülern. Bevor eine Arbeit an einen Korrekturdienst geht, werden alle Kennungen durch Platzhalter ersetzt. Finde dafür jede Kennung im Text. Im Zweifel aufführen: Eine übersehene Kennung ist schlimmer als eine zu viel.

Kennungen sind:
- Person: Namen von Privatpersonen (Vor-, Nach- und Spitznamen), auch klein oder falsch geschrieben und im Genitiv. Bei „Frau Wolf“ nur „Wolf“.
- Ort: Straßen, Hausnummern, Postleitzahlen und Orts- oder Stadtteilnamen, in denen jemand wohnt, zur Schule geht oder im Verein ist.
- Einrichtung: Schulen, Vereine, Praxen, Betriebe und andere Einrichtungen mit Eigennamen.
- Kontakt: E-Mail-Adressen, Telefonnummern, Benutzernamen, Links.
- Datum: Geburtstage und andere Daten, die zu einer Person gehören (Datum über einem Brief, Tag eines Unfalls).
- Nummer: Ausweis-, Kunden-, Mitglieds- und Kontonummern, IBAN, Kennzeichen.
Keine Kennungen und darum nicht aufführen: Namen aus der Aufgabenstellung, Figuren aus Büchern und Filmen, Autorinnen und Autoren, allgemein bekannte Personen, Länder und Reiseziele ohne Wohnbezug, historische Daten.

Zusätzlich: Sensible Angaben über die Schreibenden oder Menschen aus ihrem Umfeld:
- Gesundheit: Krankheiten, Behinderungen, Therapien, Medikamente, Diagnosen.
- Herkunft: Herkunft, Flucht, Staatsangehörigkeit, Hautfarbe, Muttersprache.
- Religion: Religion und religiöse Praxis.
- Politik: politische Meinungen, Parteien, Demonstrationen.
- Sexualität: sexuelle Orientierung und Sexualleben.
- Gewerkschaft: Mitgliedschaft in einer Gewerkschaft.
- Lebensumstände: Trennung der Eltern, Arbeitslosigkeit, Geldsorgen, Jugendamt, Gefängnis, Todesfälle in der Familie.

Zitiere jede Stelle wörtlich und buchstabengetreu aus dem Text, mit allen Fehlern, so kurz wie möglich. Führe jede Schreibweise einmal auf.

Beispiel. Arbeit „Becker Tom 6a.pdf“, Aufgabe „Schreibe an Herrn Stein über dein Wochenende.“
Text:
Lieber Herr Stein, am Samstag war ich mit nina und
ihrem Bruder Kalle bei Ninas Oma in Altenstadt, Bergstraße 4.
Wir haben über Harry Potter geredet. Kalle hat Asthma.
Antwort:
{"kennungen":[{"zitat":"nina","kategorie":"Person"},{"zitat":"Kalle","kategorie":"Person"},{"zitat":"Ninas","kategorie":"Person"},{"zitat":"Altenstadt","kategorie":"Ort"},{"zitat":"Bergstraße 4","kategorie":"Ort"}],"sensibel":[{"zitat":"Kalle hat Asthma","kategorie":"Gesundheit"}]}

Antworte nur mit JSON.`;

const MAX_QUOTE = 48;
const MAX_OUTPUT_TOKENS = 1024;
const MAX_CHUNK_CHARS = 3000;

function itemSchema(labels: Readonly<Record<string, unknown>>) {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        zitat: { type: 'string', maxLength: MAX_QUOTE },
        kategorie: { type: 'string', enum: Object.keys(labels) },
      },
      required: ['zitat', 'kategorie'],
    },
  };
}

const SCHEMA = {
  type: 'object',
  properties: {
    kennungen: itemSchema(IDENTIFIER_LABELS),
    sensibel: itemSchema(SENSITIVE_LABELS),
  },
  required: ['kennungen', 'sensibel'],
};

export function privacyRequest(lines: readonly string[], context: DetectorContext): ChatRequest {
  const header = [
    `Name der Datei: ${context.workName}`,
    `Fach: ${context.subject ?? 'Deutsch'}`,
    context.task ? `Aufgabenstellung: ${context.task}` : 'Aufgabenstellung: keine',
  ].join('\n');
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `${header}\n\nText:\n${lines.join('\n')}` },
  ];
  return {
    messages,
    temperature: 0,
    max_tokens: MAX_OUTPUT_TOKENS,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'personenbezug', schema: SCHEMA },
    },
  };
}

export type QuoteItem =
  | { readonly quote: string; readonly kind: 'identifier'; readonly category: IdentifierCategory }
  | { readonly quote: string; readonly kind: 'sensitive'; readonly category: SensitiveCategory };

function fieldsOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function readItems<C extends IdentifierCategory | SensitiveCategory>(
  value: unknown,
  labels: Readonly<Record<string, C>>,
): { quote: string; category: C }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const fields = fieldsOf(entry);
    const quote = typeof fields['zitat'] === 'string' ? fields['zitat'].trim() : '';
    const label = fields['kategorie'];
    const category =
      typeof label === 'string' && Object.hasOwn(labels, label) ? labels[label] : undefined;
    return quote === '' || category === undefined ? [] : [{ quote, category }];
  });
}

export function parseAnswer(content: string): QuoteItem[] {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end < start) return [];
  let json: Record<string, unknown>;
  try {
    json = fieldsOf(JSON.parse(content.slice(start, end + 1)));
  } catch {
    return [];
  }
  return [
    ...readItems(json['kennungen'], IDENTIFIER_LABELS).map((item): QuoteItem => ({
      ...item,
      kind: 'identifier',
    })),
    ...readItems(json['sensibel'], SENSITIVE_LABELS).map((item): QuoteItem => ({
      ...item,
      kind: 'sensitive',
    })),
  ];
}

const ROLE_WORDS =
  /^(?:(?:frau|herr|herrn|fr\.|hr\.|dr\.|onkel|tante|oma|opa|cousin|cousine|bruder|schwester|freund|freundin|mitschüler|mitschülerin|lehrer|lehrerin|trainer|trainerin|liebe|lieber|hallo|mein|meine|meinem|meiner|dein|deine)\s+)+/iu;

const NOT_IDENTIFIER_WORDS: ReadonlySet<string> = new Set(
  `mama mami mutti papa papi vati oma omi opa opi mutter vater eltern großeltern familie geschwister
  bruder schwester tante onkel cousin cousine nichte neffe sohn tochter enkel baby freund freundin
  lehrer lehrerin klasse schule montag dienstag mittwoch donnerstag freitag samstag sonntag wochenende
  januar februar märz april mai juni juli august september oktober november dezember deutschland
  österreich schweiz europa afrika asien amerika usa türkei ukraine russland polen syrien italien
  spanien frankreich griechenland kroatien england spd cdu csu afd fdp grüne grünen linke bsw verdi ver.di
  gew ngg`
    .split(/\s+/u)
    .filter(Boolean),
);

const CLASS_LABEL = /^(?:klasse\s?)?\d{1,2}\s?[a-f]\.?$/iu;
const BARE_NUMBER =
  /^[\d\s.,:]*\d[\d\s.,:]*(?:\s?(?:uhr|euro|€|cent|jahre|jahren|jahre alt|prozent|%|km|meter|punkte))?\.?$/iu;
const AMOUNT =
  /^\d[\d.,]*\s?(?:euro|€|cent|jahre|jahren|jahre alt|prozent|%|km|meter|punkte)\.?$/iu;
const DAY_MONTH = /\d\s?\.\s?\d/u;

function notAnIdentifier(quote: string, category: IdentifierCategory): boolean {
  const words = quote
    .toLocaleLowerCase('de')
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  if (words.length > 0 && words.every((word) => NOT_IDENTIFIER_WORDS.has(word))) {
    return !/\d/u.test(quote);
  }
  if (category === 'number' && (AMOUNT.test(quote) || /^\d{1,3}$/u.test(quote))) return true;
  if (category === 'contact' || category === 'number') return false;
  if (CLASS_LABEL.test(quote)) return true;
  if (!BARE_NUMBER.test(quote)) return false;
  if (/uhr|:/iu.test(quote)) return true;
  if (category === 'date') return !DAY_MONTH.test(quote);
  return category !== 'place' || quote.replaceAll(/\D/gu, '').length < 5;
}

const WORD_LIMIT: Readonly<Record<IdentifierCategory, number>> = {
  person: 4,
  place: 8,
  institution: 8,
  contact: 12,
  date: 12,
  number: 12,
};

const SENSITIVE_OVERRIDES: Readonly<Record<IdentifierCategory, readonly SensitiveCategory[]>> = {
  person: [],
  place: ['origin'],
  institution: ['union', 'politics'],
  contact: ['health', 'origin', 'religion', 'politics', 'sexuality', 'union', 'circumstances'],
  date: [],
  number: [],
};

function normalizeQuote(quote: string): string {
  return quote
    .toLocaleLowerCase('de')
    .replaceAll(/[-‐]/gu, '')
    .replaceAll(/\s+/gu, ' ')
    .replace(/^[^\p{L}\p{N}@+]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '');
}

export function cleanItems(items: readonly QuoteItem[], task: string | undefined): QuoteItem[] {
  const taskWords = new Set(
    (task ?? '')
      .toLocaleLowerCase('de')
      .split(/[^\p{L}]+/u)
      .filter((word) => word.length > 1),
  );
  const sensitive = items.filter((item) => item.kind === 'sensitive');
  return items.flatMap((item): QuoteItem[] => {
    if (item.kind === 'sensitive') return [item];
    const quote = item.quote.replace(ROLE_WORDS, '').trim();
    const words = quote.split(/\s+/u).filter(Boolean);
    if (words.length === 0 || words.length > WORD_LIMIT[item.category]) return [];
    if (notAnIdentifier(quote, item.category)) return [];
    const letters = words
      .map((word) => word.toLocaleLowerCase('de').replaceAll(/[^\p{L}]/gu, ''))
      .filter(Boolean);
    if (
      item.category === 'person' &&
      letters.length > 0 &&
      letters.every((word) => taskWords.has(word))
    ) {
      return [];
    }
    const own = normalizeQuote(quote);
    const reported = sensitive.some(
      (entry) =>
        SENSITIVE_OVERRIDES[item.category].includes(entry.category) &&
        normalizeQuote(entry.quote).includes(own),
    );
    return reported ? [] : [{ ...item, quote }];
  });
}

const LETTER = /[\p{L}\p{N}]/u;

interface Flat {
  readonly text: string;
  readonly source: readonly { readonly line: number; readonly offset: number }[];
}

function flatten(lines: readonly string[]): Flat {
  let text = '';
  const source: { line: number; offset: number }[] = [];
  lines.forEach((line, row) => {
    for (let offset = 0; offset < line.length; offset += 1) {
      const char = line.charAt(offset);
      if (char === '-' || char === '‐') continue;
      const lower = /\s/u.test(char) ? ' ' : char.toLocaleLowerCase('de');
      if (lower === ' ' && text.endsWith(' ')) continue;
      text += lower;
      source.push({ line: row + 1, offset });
    }
    if (!/[-‐]\s*$/u.test(line) && !text.endsWith(' ')) {
      text += ' ';
      source.push({ line: row + 1, offset: line.length });
    }
  });
  return { text, source };
}

function toSpans(flat: Flat, start: number, end: number, item: QuoteItem): PrivacySpan[] {
  const parts: { line: number; offset: number; length: number }[] = [];
  for (let at = start; at < end; at += 1) {
    const position = flat.source[at];
    if (position === undefined || flat.text[at] === ' ') continue;
    const last = parts.at(-1);
    if (last && last.line === position.line && position.offset <= last.offset + last.length + 1) {
      last.length = position.offset + 1 - last.offset;
    } else {
      parts.push({ line: position.line, offset: position.offset, length: 1 });
    }
  }
  return parts.map((part): PrivacySpan =>
    item.kind === 'identifier'
      ? { ...part, kind: 'identifier', category: item.category, source: 'model' }
      : { ...part, kind: 'sensitive', category: item.category, source: 'model' },
  );
}

function exactMatches(flat: Flat, quote: string): [number, number][] {
  const matches: [number, number][] = [];
  for (let from = flat.text.indexOf(quote); from >= 0; from = flat.text.indexOf(quote, from + 1)) {
    const before = flat.text[from - 1] ?? ' ';
    if (LETTER.test(before) && LETTER.test(quote.charAt(0))) continue;
    let end = from + quote.length;
    while (LETTER.test(flat.text[end] ?? '') && end - from - quote.length < 2) end += 1;
    const tail = flat.text.slice(from + quote.length, end);
    if (tail !== '' && !/^(?:s|'s|’s)$/u.test(tail)) continue;
    matches.push([from, from + quote.length]);
  }
  return matches;
}

function fuzzyMatches(flat: Flat, quote: string): [number, number][] {
  const words = [...flat.text.matchAll(/\S+/gu)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  const size = quote.split(' ').length;
  const limit = Math.max(1, Math.floor(quote.length * 0.25));
  let best = limit + 1;
  let found: [number, number][] = [];
  for (let index = 0; index + size <= words.length; index += 1) {
    const start = words[index]?.start ?? 0;
    const end = words[index + size - 1]?.end ?? 0;
    const candidate = flat.text.slice(start, end).replace(/[^\p{L}\p{N}]+$/u, '');
    if (Math.abs(candidate.length - quote.length) > limit) continue;
    const cost = editDistance(candidate, quote);
    if (cost < best) {
      best = cost;
      found = [];
    }
    if (cost === best) found.push([start, start + candidate.length]);
  }
  return best <= limit ? found : [];
}

export function locateQuotes(lines: readonly string[], items: readonly QuoteItem[]): PrivacySpan[] {
  const flat = flatten(lines);
  return items.flatMap((item) => {
    const quote = normalizeQuote(item.quote);
    if (quote === '') return [];
    const exact = exactMatches(flat, quote);
    const ranges = exact.length > 0 ? exact : quote.length >= 3 ? fuzzyMatches(flat, quote) : [];
    return ranges.flatMap(([start, end]) => toSpans(flat, start, end, item));
  });
}

export function chunkLines(lines: readonly string[]): { start: number; lines: string[] }[] {
  const chunks: { start: number; lines: string[] }[] = [];
  let current: { start: number; lines: string[]; size: number } | null = null;
  lines.forEach((line, index) => {
    if (
      current === null ||
      (current.size + line.length > MAX_CHUNK_CHARS && current.lines.length > 0)
    ) {
      current = { start: index, lines: [], size: 0 };
      chunks.push(current);
    }
    current.lines.push(line);
    current.size += line.length + 1;
  });
  return chunks.map(({ start, lines: chunk }) => ({ start, lines: chunk }));
}

export type AskModel = (
  modelId: string,
  request: ChatRequest,
  signal: AbortSignal,
) => Promise<string>;

export interface ModelDetectorOptions {
  readonly models: readonly string[];
  readonly sensitiveModel: string;
  readonly ask: AskModel;
  readonly loaded?: () => string | null;
  readonly unknownWords?: UnknownWords;
}

const MIN_NOUN_LENGTH = 7;

const NAME_CUE =
  /(?:^|[^\p{L}])(?:frau|herr|herrn|familie|fam\.|dr\.|prof\.|bei|liebe|lieber|geehrte|geehrter|vater|mutter|papa|mama|opa|oma|onkel|tante|bruder|schwester|cousin|cousine|freund|freundin|nachbar|nachbarin|trainer|trainerin|lehrer|lehrerin)\s+$/iu;

function surnameWord(word: string): boolean {
  const lower = word.toLocaleLowerCase('de');
  return WORD_SURNAMES.has(lower) || (lower.endsWith('s') && WORD_SURNAMES.has(lower.slice(0, -1)));
}

function namedInText(quote: string, text: string): boolean {
  for (const match of text.matchAll(new RegExp(`(?<![\\p{L}])${quote}(?![\\p{L}])`, 'gu'))) {
    const before = text.slice(Math.max(0, match.index - 40), match.index);
    if (NAME_CUE.test(before)) return true;
    const previous = /(\p{L}+)\s+$/u.exec(before)?.[1];
    if (previous !== undefined && isFirstName(previous)) return true;
  }
  return false;
}

function nounCandidate(item: QuoteItem, text: string): boolean {
  return (
    (item.category === 'person' || item.category === 'institution') &&
    /^\p{Lu}\p{Ll}+$/u.test(item.quote) &&
    item.quote.length >= MIN_NOUN_LENGTH &&
    !isFirstName(item.quote) &&
    !surnameWord(item.quote) &&
    !namedInText(item.quote, text)
  );
}

async function withoutNouns(
  items: readonly QuoteItem[],
  lines: readonly string[],
  unknownWords: UnknownWords | undefined,
  signal: AbortSignal,
): Promise<QuoteItem[]> {
  const text = lines.join('\n');
  const candidates = items.filter((item) => nounCandidate(item, text)).map((item) => item.quote);
  if (unknownWords === undefined || candidates.length === 0) return [...items];
  const unknown = await unknownWords([...new Set(candidates)], signal);
  return items.filter((item) => !nounCandidate(item, text) || unknown.has(item.quote));
}

function shift(spans: readonly PrivacySpan[], by: number): PrivacySpan[] {
  return spans.map((span) => ({ ...span, line: span.line + by }));
}

export function createModelDetector(options: ModelDetectorOptions): Detector {
  const { models, sensitiveModel, ask, loaded, unknownWords } = options;
  return async (lines, context, signal) => {
    const current = loaded?.() ?? null;
    const order =
      current !== null && models.includes(current)
        ? [current, ...models.filter((model) => model !== current)]
        : [...models];
    const spans: PrivacySpan[] = [];
    for (const chunk of chunkLines(lines)) {
      if (chunk.lines.every((line) => line.trim() === '')) continue;
      const answers = new Map<string, QuoteItem[]>();
      for (const model of order) {
        signal.throwIfAborted();
        answers.set(
          model,
          parseAnswer(await ask(model, privacyRequest(chunk.lines, context), signal)),
        );
      }
      const identifiers = await withoutNouns(
        cleanItems([...answers.values()].flat(), context.task).filter(
          (item) => item.kind === 'identifier',
        ),
        chunk.lines,
        unknownWords,
        signal,
      );
      const shown = (answers.get(sensitiveModel) ?? []).filter((item) => item.kind === 'sensitive');
      const items = [...identifiers, ...shown];
      spans.push(...shift(locateQuotes(chunk.lines, items), chunk.start));
    }
    return spans;
  };
}
