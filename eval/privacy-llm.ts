import type {
  DetectorContext,
  IdentifierCategory,
  PrivacyCategory,
  PrivacySpan,
  SensitiveCategory,
} from './privacy-sample.ts';
import { distance } from './privacy-rules.ts';
import { record } from './server.ts';

export const IDENTIFIER_LABELS: Record<string, IdentifierCategory> = {
  Person: 'person',
  Ort: 'place',
  Einrichtung: 'institution',
  Kontakt: 'contact',
  Datum: 'date',
  Nummer: 'number',
};

export const SENSITIVE_LABELS: Record<string, SensitiveCategory> = {
  Gesundheit: 'health',
  Herkunft: 'origin',
  Religion: 'religion',
  Politik: 'politics',
  Sexualität: 'sexuality',
  Gewerkschaft: 'union',
  Lebensumstände: 'circumstances',
};

export const VARIANTS = ['kurz', 'regeln', 'zeilen', 'beispiele', 'sensibel', 'nachlese'] as const;
export type Variant = (typeof VARIANTS)[number];

export function isVariant(value: string): value is Variant {
  return (VARIANTS as readonly string[]).includes(value);
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface Item {
  quote: string;
  category: PrivacyCategory;
  kind: 'identifier' | 'sensitive';
  line?: number;
}

const IDENTIFIER_RULES = `Kennungen sind:
- Person: Namen von Privatpersonen (Vor-, Nach- und Spitznamen), auch klein oder falsch geschrieben und im Genitiv. Bei „Frau Wolf“ nur „Wolf“.
- Ort: Straßen, Hausnummern, Postleitzahlen und Orts- oder Stadtteilnamen, in denen jemand wohnt, zur Schule geht oder im Verein ist.
- Einrichtung: Schulen, Vereine, Praxen, Betriebe und andere Einrichtungen mit Eigennamen.
- Kontakt: E-Mail-Adressen, Telefonnummern, Benutzernamen, Links.
- Datum: Geburtstage und andere Daten, die zu einer Person gehören (Datum über einem Brief, Tag eines Unfalls).
- Nummer: Ausweis-, Kunden-, Mitglieds- und Kontonummern, IBAN, Kennzeichen.
Keine Kennungen und darum nicht aufführen: Namen aus der Aufgabenstellung, Figuren aus Büchern und Filmen, Autorinnen und Autoren, allgemein bekannte Personen, Länder und Reiseziele ohne Wohnbezug, historische Daten.`;

const SENSITIVE_RULES = `Sensible Angaben über die Schreibenden oder Menschen aus ihrem Umfeld:
- Gesundheit: Krankheiten, Behinderungen, Therapien, Medikamente, Diagnosen.
- Herkunft: Herkunft, Flucht, Staatsangehörigkeit, Hautfarbe, Muttersprache.
- Religion: Religion und religiöse Praxis.
- Politik: politische Meinungen, Parteien, Demonstrationen.
- Sexualität: sexuelle Orientierung und Sexualleben.
- Gewerkschaft: Mitgliedschaft in einer Gewerkschaft.
- Lebensumstände: Trennung der Eltern, Arbeitslosigkeit, Geldsorgen, Jugendamt, Gefängnis, Todesfälle in der Familie.`;

const EXAMPLE = `Beispiel. Arbeit „Becker Tom 6a.pdf“, Aufgabe „Schreibe an Herrn Stein über dein Wochenende.“
Text:
Lieber Herr Stein, am Samstag war ich mit nina und
ihrem Bruder Kalle bei Ninas Oma in Altenstadt, Bergstraße 4.
Wir haben über Harry Potter geredet. Kalle hat Asthma.
Antwort:
{"kennungen":[{"zitat":"nina","kategorie":"Person"},{"zitat":"Kalle","kategorie":"Person"},{"zitat":"Ninas","kategorie":"Person"},{"zitat":"Altenstadt","kategorie":"Ort"},{"zitat":"Bergstraße 4","kategorie":"Ort"}],"sensibel":[{"zitat":"Kalle hat Asthma","kategorie":"Gesundheit"}]}`;

function header(context: DetectorContext): string {
  return [
    `Name der Datei: ${context.workName}`,
    `Fach: ${context.subject ?? 'Deutsch'}`,
    context.task ? `Aufgabenstellung: ${context.task}` : 'Aufgabenstellung: keine',
  ].join('\n');
}

function itemSchema(labels: Record<string, unknown>, withLine: boolean) {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        ...(withLine ? { zeile: { type: 'integer' } } : {}),
        zitat: { type: 'string', maxLength: 48 },
        kategorie: { type: 'string', enum: Object.keys(labels) },
      },
      required: [...(withLine ? ['zeile'] : []), 'zitat', 'kategorie'],
    },
  };
}

export function schemaFor(variant: Variant) {
  const withLine = variant === 'zeilen';
  const properties: Record<string, unknown> = {};
  if (variant !== 'sensibel') properties['kennungen'] = itemSchema(IDENTIFIER_LABELS, withLine);
  if (variant !== 'kurz' && variant !== 'nachlese') {
    properties['sensibel'] = itemSchema(SENSITIVE_LABELS, withLine);
  }
  return { type: 'object', properties, required: Object.keys(properties) };
}

export function buildMessages(
  variant: Variant,
  lines: readonly string[],
  context: DetectorContext,
): ChatMessage[] {
  const text =
    variant === 'zeilen'
      ? lines.map((line, index) => `${index + 1}: ${line}`).join('\n')
      : lines.join('\n');
  const quoteRule =
    'Zitiere jede Stelle wörtlich und buchstabengetreu aus dem Text, mit allen Fehlern, so kurz wie möglich. Führe jede Schreibweise einmal auf.';
  if (variant === 'kurz') {
    return [
      {
        role: 'system',
        content: `Du findest in einer Schülerarbeit alle Kennungen, über die man Menschen erkennen kann: Namen, Wohnorte, Adressen, Schulen und Vereine, Kontaktdaten, persönliche Daten und Nummern. Figuren aus Büchern und bekannte Personen gehören nicht dazu. ${quoteRule} Antworte nur mit JSON.`,
      },
      { role: 'user', content: text },
    ];
  }
  if (variant === 'sensibel') {
    return [
      {
        role: 'system',
        content: `Du prüfst eine Schülerarbeit auf sensible Angaben. ${SENSITIVE_RULES}\nZitiere nur Stellen, die wirklich eine solche Angabe enthalten, wörtlich und so kurz wie möglich. Wenn es keine gibt, gib eine leere Liste zurück. Antworte nur mit JSON.`,
      },
      { role: 'user', content: `${header(context)}\n\nText:\n${text}` },
    ];
  }
  const system = [
    'Du schützt die Daten von Schülerinnen und Schülern. Bevor eine Arbeit an einen Korrekturdienst geht, werden alle Kennungen durch Platzhalter ersetzt. Finde dafür jede Kennung im Text. Im Zweifel aufführen: Eine übersehene Kennung ist schlimmer als eine zu viel.',
    IDENTIFIER_RULES,
    variant === 'nachlese' ? '' : `Zusätzlich: ${SENSITIVE_RULES}`,
    variant === 'zeilen'
      ? `${quoteRule} Gib zu jeder Stelle die Zeilennummer an. Steht eine Kennung über zwei Zeilen, führe beide Teile mit ihrer Zeile auf.`
      : quoteRule,
    variant === 'beispiele' || variant === 'nachlese' ? EXAMPLE : '',
    'Antworte nur mit JSON.',
  ]
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `${header(context)}\n\nText:\n${text}` },
  ];
}

export function nachleseMessages(
  lines: readonly string[],
  context: DetectorContext,
  found: readonly string[],
): ChatMessage[] {
  const messages = buildMessages('nachlese', lines, context);
  const last = messages.at(-1);
  if (last) {
    last.content += `\n\nBereits gefunden: ${found.length > 0 ? found.join(', ') : 'nichts'}.\nLies den Text noch einmal Zeile für Zeile und führe nur Kennungen auf, die noch fehlen, auch andere Schreibweisen derselben Namen. Wenn nichts fehlt, gib eine leere Liste zurück.`;
  }
  return messages;
}

function readItems(
  value: unknown,
  labels: Record<string, PrivacyCategory>,
  kind: Item['kind'],
): Item[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const fields = record(entry);
    const quote = typeof fields['zitat'] === 'string' ? fields['zitat'].trim() : '';
    const category = labels[String(fields['kategorie'])];
    if (quote === '' || category === undefined) return [];
    const line = typeof fields['zeile'] === 'number' ? fields['zeile'] : undefined;
    return [{ quote, category, kind, ...(line === undefined ? {} : { line }) }];
  });
}

export function parseAnswer(content: string): Item[] {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end < start) return [];
  try {
    const json = record(JSON.parse(content.slice(start, end + 1)));
    return [
      ...readItems(json['kennungen'], IDENTIFIER_LABELS, 'identifier'),
      ...readItems(json['sensibel'], SENSITIVE_LABELS, 'sensitive'),
    ];
  } catch {
    return [];
  }
}

const LETTER = /[\p{L}\p{N}]/u;

interface Flat {
  text: string;
  source: { line: number; offset: number }[];
}

function flatten(lines: readonly string[]): Flat {
  let text = '';
  const source: Flat['source'] = [];
  lines.forEach((line, row) => {
    for (let offset = 0; offset < line.length; offset++) {
      const char = line[offset] ?? '';
      if (char === '-' || char === '‐') continue;
      const lower = /\s/u.test(char) ? ' ' : char.toLowerCase();
      if (lower === ' ' && text.endsWith(' ')) continue;
      text += lower;
      source.push({ line: row + 1, offset });
    }
    const hyphenated = /[-‐]\s*$/u.test(line);
    if (!hyphenated && !text.endsWith(' ')) {
      text += ' ';
      source.push({ line: row + 1, offset: line.length });
    }
  });
  return { text, source };
}

function normalizeQuote(quote: string): string {
  return quote
    .toLowerCase()
    .replaceAll(/[-‐]/gu, '')
    .replaceAll(/\s+/gu, ' ')
    .replace(/^[^\p{L}\p{N}@+]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '');
}

function toSpans(flat: Flat, start: number, end: number, item: Item): PrivacySpan[] {
  const spans: PrivacySpan[] = [];
  for (let at = start; at < end; at++) {
    const position = flat.source[at];
    if (!position || flat.text[at] === ' ') continue;
    const last = spans.at(-1);
    if (last && last.line === position.line && position.offset <= last.offset + last.length + 1) {
      last.length = position.offset + 1 - last.offset;
    } else {
      spans.push({
        line: position.line,
        offset: position.offset,
        length: 1,
        kind: item.kind,
        category: item.category,
        source: 'model',
      });
    }
  }
  return spans;
}

function exactMatches(flat: Flat, quote: string): [number, number][] {
  const matches: [number, number][] = [];
  for (let from = flat.text.indexOf(quote); from >= 0; from = flat.text.indexOf(quote, from + 1)) {
    let end = from + quote.length;
    const before = flat.text[from - 1] ?? ' ';
    if (LETTER.test(before) && LETTER.test(quote[0] ?? '')) continue;
    while (LETTER.test(flat.text[end] ?? '') && end - from - quote.length < 2) end++;
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
  for (let index = 0; index + size <= words.length; index++) {
    const start = words[index]?.start ?? 0;
    const end = words[index + size - 1]?.end ?? 0;
    const candidate = flat.text.slice(start, end).replace(/[^\p{L}\p{N}]+$/u, '');
    if (Math.abs(candidate.length - quote.length) > limit) continue;
    const cost = distance(candidate, quote);
    if (cost < best) {
      best = cost;
      found = [];
    }
    if (cost === best) found.push([start, start + candidate.length]);
  }
  return best <= limit ? found : [];
}

export function locate(lines: readonly string[], items: readonly Item[]): PrivacySpan[] {
  const flat = flatten(lines);
  return items.flatMap((item) => {
    const quote = normalizeQuote(item.quote);
    if (quote === '') return [];
    const exact = exactMatches(flat, quote);
    const ranges = exact.length > 0 ? exact : quote.length >= 3 ? fuzzyMatches(flat, quote) : [];
    return ranges.flatMap(([start, end]) => toSpans(flat, start, end, item));
  });
}

const ROLE_WORDS =
  /^(?:(?:frau|herr|herrn|fr\.|hr\.|dr\.|onkel|tante|oma|opa|cousin|cousine|bruder|schwester|freund|freundin|mitschüler|mitschülerin|lehrer|lehrerin|trainer|trainerin|liebe|lieber|hallo|mein|meine|meinem|meiner|dein|deine)\s+)+/iu;

export function cleanItems(items: readonly Item[], context: DetectorContext): Item[] {
  const taskWords = new Set(
    (context.task ?? '')
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .filter((word) => word.length > 1),
  );
  return items.flatMap((item) => {
    if (item.kind === 'sensitive') return [item];
    const quote = item.quote.replace(ROLE_WORDS, '').trim();
    const words = quote.split(/\s+/u).filter(Boolean);
    const limit =
      item.category === 'person' ? 4 : ['place', 'institution'].includes(item.category) ? 8 : 12;
    if (words.length === 0 || words.length > limit) return [];
    const letters = words
      .map((word) => word.toLowerCase().replace(/[^\p{L}]/gu, ''))
      .filter(Boolean);
    if (
      item.category === 'person' &&
      letters.length > 0 &&
      letters.every((word) => taskWords.has(word))
    )
      return [];
    return [{ ...item, quote }];
  });
}
