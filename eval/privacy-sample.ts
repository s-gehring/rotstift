import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';

export const IDENTIFIER_CATEGORIES = [
  'person',
  'place',
  'institution',
  'contact',
  'date',
  'number',
] as const;
export const SENSITIVE_CATEGORIES = [
  'health',
  'origin',
  'religion',
  'politics',
  'sexuality',
  'union',
  'circumstances',
] as const;

export type IdentifierCategory = (typeof IDENTIFIER_CATEGORIES)[number];
export type SensitiveCategory = (typeof SENSITIVE_CATEGORIES)[number];
export type PrivacyCategory = IdentifierCategory | SensitiveCategory;
export type GoldCategory = PrivacyCategory | 'keep';

export interface PrivacySpan {
  line: number;
  offset: number;
  length: number;
  kind: 'identifier' | 'sensitive';
  category: PrivacyCategory;
  source: 'rule' | 'name-list' | 'model' | 'teacher';
}

export interface DetectorContext {
  workName: string;
  subject?: string;
  language: string;
  task?: string;
}

export type Detector = (
  lines: readonly string[],
  context: DetectorContext,
  signal: AbortSignal,
) => Promise<PrivacySpan[]>;

export interface GoldSpan {
  line: number;
  offset: number;
  length: number;
  category: GoldCategory;
  occurrence: number;
}

export interface PrivacySample {
  id: string;
  workName: string;
  grade: number;
  form: string;
  subject: string;
  task?: string;
  lines: string[];
  gold: GoldSpan[];
}

const CATEGORIES = new Set<string>([...IDENTIFIER_CATEGORIES, ...SENSITIVE_CATEGORIES, 'keep']);

function isGoldCategory(value: string): value is GoldCategory {
  return CATEGORIES.has(value);
}

export function isIdentifier(category: GoldCategory): category is IdentifierCategory {
  return (IDENTIFIER_CATEGORIES as readonly string[]).includes(category);
}

export function isSensitive(category: GoldCategory): category is SensitiveCategory {
  return (SENSITIVE_CATEGORIES as readonly string[]).includes(category);
}

export function parseBody(body: string): { lines: string[]; gold: GoldSpan[] } {
  const lines: string[] = [''];
  const gold: GoldSpan[] = [];
  const open: { line: number; offset: number }[] = [];
  let occurrence = 0;
  for (let index = 0; index < body.length; index++) {
    const char = body[index] ?? '';
    if (char === '[') {
      open.push({ line: lines.length - 1, offset: (lines.at(-1) ?? '').length });
    } else if (char === ']') {
      const start = open.pop();
      const match = /^\{([a-z]+)\}/u.exec(body.slice(index + 1));
      if (!start || !match) throw new Error(`Markierung ohne Klammer oder Kategorie bei ${index}`);
      const category = match[1] ?? '';
      if (!isGoldCategory(category)) throw new Error(`Unbekannte Kategorie ${category}`);
      for (let line = start.line; line < lines.length; line++) {
        const offset = line === start.line ? start.offset : 0;
        const length = (lines[line] ?? '').length - offset;
        if (length > 0) {
          gold.push({
            line: line + 1,
            offset,
            length,
            category,
            occurrence,
          });
        }
      }
      occurrence++;
      index += match[0].length;
    } else if (char === '\n') {
      lines.push('');
    } else {
      lines[lines.length - 1] += char;
    }
  }
  if (open.length > 0) throw new Error('Offene Markierung');
  return { lines, gold };
}

export function parseSample(id: string, source: string): PrivacySample {
  const [head, body] = source.split(/\n---\n/u, 2);
  if (head === undefined || body === undefined) throw new Error(`${id}: Trenner --- fehlt`);
  const fields = new Map(
    head.split('\n').map((line) => {
      const at = line.indexOf(':');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()] as const;
    }),
  );
  const workName = fields.get('arbeit');
  if (!workName) throw new Error(`${id}: arbeit fehlt`);
  const { lines, gold } = parseBody(body.replace(/\n+$/u, ''));
  const task = fields.get('aufgabe');
  return {
    id,
    workName,
    grade: Number(fields.get('klasse') ?? 0),
    form: fields.get('form') ?? '',
    subject: fields.get('fach') ?? 'Deutsch',
    ...(task ? { task } : {}),
    lines,
    gold,
  };
}

export function readSamples(dir: string): PrivacySample[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.txt'))
    .toSorted()
    .map((name) => parseSample(basename(name, '.txt'), readFileSync(join(dir, name), 'utf8')));
}

function main() {
  const dirs = process.argv.slice(2);
  const counts = new Map<string, number>();
  let samples = 0;
  let words = 0;
  for (const dir of dirs) {
    for (const sample of readSamples(dir)) {
      samples++;
      words += sample.lines.join(' ').split(/\s+/u).filter(Boolean).length;
      const seen = new Set<number>();
      for (const span of sample.gold) {
        if (seen.has(span.occurrence)) continue;
        seen.add(span.occurrence);
        counts.set(span.category, (counts.get(span.category) ?? 0) + 1);
      }
      const long = sample.lines.filter((line) => line.length > 70);
      if (long.length > 0) console.log(`${sample.id}: ${long.length} Zeilen über 70 Zeichen`);
    }
  }
  console.log(`${samples} Proben, ${words} Wörter`);
  console.log([...counts].map(([category, count]) => `${category} ${count}`).join(', '));
}

if (import.meta.main) main();
