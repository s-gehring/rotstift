export type ReviewKind = 'content' | 'form';

export interface Defect {
  readonly kind: ReviewKind;
  readonly label: string;
  readonly keywords: readonly string[];
  readonly line: number | null;
}

export interface ReviewSample {
  readonly id: string;
  readonly subject: string;
  readonly form: string;
  readonly assignment: string;
  readonly lines: readonly string[];
  readonly defects: readonly Defect[];
}

const isKind = (value: string): value is ReviewKind => value === 'content' || value === 'form';

function anchorLine(anchor: string, lines: readonly string[], id: string): number | null {
  if (anchor === '*') return null;
  if (anchor === 'first') return 1;
  if (anchor === 'last') return lines.length;
  const index = lines.findIndex((line) => line.includes(anchor));
  if (index < 0) throw new Error(`${id}: Anker „${anchor}“ steht in keiner Zeile`);
  return index + 1;
}

export function parseSample(id: string, source: string): ReviewSample {
  const [head = '', ...body] = source.split(/^---$/m);
  const lines = body.join('---').trim().split('\n');
  const fields = new Map<string, string>();
  const defects: Defect[] = [];
  for (const row of head.trim().split('\n')) {
    const match = /^(\w+):\s*(.*)$/.exec(row);
    if (!match) throw new Error(`${id}: Kopfzeile „${row}“ unbekannt`);
    const [, key = '', value = ''] = match;
    if (key !== 'Mangel') {
      fields.set(key, value.trim());
      continue;
    }
    const [kind = '', label = '', keywords = '', anchor = ''] = value
      .split('|')
      .map((part) => part.trim());
    if (!isKind(kind) || !anchor.startsWith('@'))
      throw new Error(`${id}: Mangel „${value}“ ungültig`);
    defects.push({
      kind,
      label,
      keywords: keywords
        .split(',')
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean),
      line: anchorLine(anchor.slice(1), lines, id),
    });
  }
  return {
    id,
    subject: fields.get('Fach') ?? 'Deutsch',
    form: fields.get('Form') ?? '',
    assignment: fields.get('Aufgabe') ?? '',
    lines,
    defects,
  };
}
