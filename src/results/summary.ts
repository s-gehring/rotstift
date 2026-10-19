import type { ImportPage } from '../import/pages.ts';
import type { PageEntry, PageStatus } from '../pipeline/runner.ts';
import { computeStatistics } from '../stats/statistics.ts';

export interface ResultRow {
  readonly id: string;
  readonly position: number;
  readonly label: string;
  readonly status: PageStatus;
  readonly words: number | null;
}

export function countPageWords(text: string): number {
  return computeStatistics({
    lines: text.split('\n').map((line, index) => ({ number: index + 1, text: line, marks: [] })),
  }).words;
}

export function buildRows(
  pages: readonly ImportPage[],
  entries: Readonly<Record<string, PageEntry>>,
): ResultRow[] {
  return pages.flatMap((page, index) => {
    const entry = entries[page.id];
    if (entry === undefined) return [];
    return [
      {
        id: page.id,
        position: index + 1,
        label: page.label,
        status: entry.status,
        words: entry.status === 'done' ? countPageWords(entry.text) : null,
      },
    ];
  });
}

export function totalWords(rows: readonly ResultRow[]): number {
  return rows.reduce((sum, row) => sum + (row.words ?? 0), 0);
}

export function wordsText(count: number): string {
  return `${count} ${count === 1 ? 'Wort' : 'Wörter'}`;
}

export function formatSummary(rows: readonly ResultRow[]): string {
  const lines = rows.map(
    (row) =>
      `Seite ${row.position} (${row.label}): ${row.words === null ? 'nicht erkannt' : wordsText(row.words)}`,
  );
  return ['Wortzählung', ...lines, `Gesamt: ${wordsText(totalWords(rows))}`].join('\n');
}
