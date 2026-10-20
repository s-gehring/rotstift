import { CATALOG, findErrorKind } from '../src/annotations/catalog.ts';
import type { CorrectionProfile } from '../src/annotations/profile.ts';
import type { Mark, Transcript } from '../src/annotations/transcript.ts';
import type { ChatMessage } from './correct-prompts.ts';

interface ListItem {
  n: number;
  type: string;
  kind: 'error' | 'missing';
  text: string;
  fix: string;
}

function exampleItem(profile: CorrectionProfile, code: string): string {
  const kind = findErrorKind(profile.language, code);
  if (!kind) throw new Error(`Fehlerart „${code}“ fehlt im Katalog.`);
  const { before, original, correction } = kind.example;
  const item: ListItem =
    original === ''
      ? {
          n: 1,
          type: code,
          kind: 'missing',
          text: before.trimEnd().split(' ').at(-1) ?? '',
          fix: correction,
        }
      : { n: 1, type: code, kind: 'error', text: original, fix: correction };
  return `  Beispiel: ${before}${original}${kind.example.after} -> ${JSON.stringify(item)}`;
}

export function listSpecification(profile: CorrectionProfile): string {
  const kinds = profile.allowedTypes.map((code) => {
    const kind = findErrorKind(profile.language, code);
    if (!kind) throw new Error(`Fehlerart „${code}“ fehlt im Katalog.`);
    return `- ${code} (${kind.name}): ${kind.description}\n${exampleItem(profile, code)}`;
  });
  return [
    `Prüfe die nummerierten Zeilen einer Schülerarbeit auf Fehler der unten genannten Fehlerarten. Fach: ${profile.subject}, Sprache: ${CATALOG[profile.language].name}.`,
    '',
    'Antworte nur mit einem JSON-Objekt {"errors": [...]}. Jeder Eintrag beschreibt einen Fehler:',
    '- n: Nummer der Zeile.',
    '- type: Kürzel der Fehlerart.',
    '- kind: "error", wenn vorhandener Text falsch ist, oder "missing", wenn etwas fehlt (zum Beispiel ein Komma).',
    '- text: Bei "error" der fehlerhafte Textteil, kopiert genau so, wie er in der Zeile steht, ohne Korrektur und so kurz wie möglich. Bei "missing" das Wort direkt vor der Lücke, genau so, wie es in der Zeile steht.',
    '- fix: Bei "error" der richtige Ersatz für text. Bei "missing" der fehlende Text.',
    '',
    'Nenne nur Fehler, bei denen du sicher bist. Ohne Fehler lautet die Antwort {"errors": []}.',
    '',
    'Fehlerarten:',
    ...kinds,
  ].join('\n');
}

export function listMessages(profile: CorrectionProfile, input: Transcript): ChatMessage[] {
  return [
    { role: 'system', content: listSpecification(profile) },
    {
      role: 'user',
      content: input.lines.map((line) => `${line.number}: ${line.text}`).join('\n'),
    },
  ];
}

export function listRepairMessages(
  messages: readonly ChatMessage[],
  answer: string,
  issues: readonly string[],
): ChatMessage[] {
  return [
    ...messages,
    { role: 'assistant', content: answer },
    {
      role: 'user',
      content: `Diese Einträge passen nicht zum Text:\n${issues.map((issue) => `- ${issue}`).join('\n')}\nGib die vollständige Liste noch einmal aus. Das Feld text muss genau so in der Zeile stehen.`,
    },
  ];
}

export function listSchema(profile: CorrectionProfile): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      errors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            n: { type: 'integer' },
            type: { type: 'string', enum: profile.allowedTypes },
            kind: { type: 'string', enum: ['error', 'missing'] },
            text: { type: 'string' },
            fix: { type: 'string' },
          },
          required: ['n', 'type', 'kind', 'text', 'fix'],
          additionalProperties: false,
        },
      },
    },
    required: ['errors'],
    additionalProperties: false,
  };
}

function readItems(json: string): { items: ListItem[]; issues: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { items: [], issues: ['Die Antwort ist kein gültiges JSON.'] };
  }
  const entries =
    typeof data === 'object' && data !== null && 'errors' in data && Array.isArray(data.errors)
      ? (data.errors as unknown[])
      : undefined;
  if (!entries) return { items: [], issues: ['Das Feld "errors" fehlt oder ist keine Liste.'] };
  const items: ListItem[] = [];
  const issues: string[] = [];
  for (const entry of entries) {
    const item = typeof entry === 'object' && entry !== null ? entry : undefined;
    if (
      item &&
      'n' in item &&
      typeof item.n === 'number' &&
      'type' in item &&
      typeof item.type === 'string' &&
      'kind' in item &&
      (item.kind === 'error' || item.kind === 'missing') &&
      'text' in item &&
      typeof item.text === 'string' &&
      'fix' in item &&
      typeof item.fix === 'string'
    ) {
      items.push({ n: item.n, type: item.type, kind: item.kind, text: item.text, fix: item.fix });
    } else {
      issues.push(`Ein Eintrag hat nicht die erwarteten Felder: ${JSON.stringify(entry)}`);
    }
  }
  return { items, issues };
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

function locate(text: string, needle: string, taken: readonly [number, number][]): number {
  if (needle === '') return -1;
  const free = (from: number) =>
    !taken.some(([start, end]) => from < end && start < from + needle.length);
  let fallback = -1;
  for (let from = text.indexOf(needle); from !== -1; from = text.indexOf(needle, from + 1)) {
    if (!free(from)) continue;
    const before = text[from - 1];
    const after = text[from + needle.length];
    const bounded =
      (before === undefined || !WORD_CHARACTER.test(before)) &&
      (after === undefined || !WORD_CHARACTER.test(after));
    if (bounded) return from;
    if (fallback === -1) fallback = from;
  }
  return fallback;
}

export interface ListResult {
  transcript: Transcript;
  issues: string[];
  items: number;
}

export function listToTranscript(input: Transcript, json: string): ListResult {
  const { items, issues } = readItems(json);
  const found = new Map<number, Mark[]>();
  const taken = new Map<number, [number, number][]>();
  for (const item of items) {
    const line = input.lines.find((entry) => entry.number === item.n);
    if (!line) {
      issues.push(`Zeile ${item.n} gibt es nicht.`);
      continue;
    }
    if (item.kind === 'error' && item.fix === item.text) {
      issues.push(`Zeile ${item.n}: Die Korrektur „${item.fix}“ ist identisch mit dem Text.`);
      continue;
    }
    const occupied = taken.get(item.n) ?? [];
    const start = locate(line.text, item.text, item.kind === 'error' ? occupied : []);
    if (start === -1) {
      issues.push(`Zeile ${item.n}: „${item.text}“ steht nicht in der Zeile.`);
      continue;
    }
    const mark: Mark =
      item.kind === 'error'
        ? {
            kind: 'error',
            type: item.type,
            original: item.text,
            correction: item.fix,
            offset: start,
          }
        : {
            kind: 'omission',
            type: item.type,
            original: '',
            correction: item.fix,
            offset: start + item.text.length,
          };
    if (item.kind === 'error') occupied.push([start, start + item.text.length]);
    taken.set(item.n, occupied);
    found.set(item.n, [...(found.get(item.n) ?? []), mark]);
  }
  return {
    transcript: {
      lines: input.lines.map((line) => ({
        ...line,
        marks: (found.get(line.number) ?? []).toSorted((a, b) => a.offset - b.offset),
      })),
    },
    issues,
    items: items.length,
  };
}
