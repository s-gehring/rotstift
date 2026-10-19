import type { ImportPage } from '../import/pages.ts';
import type { PageEntry, PageStatus } from '../pipeline/runner.ts';
import { continuesHyphenation, computeStatistics } from '../stats/statistics.ts';

export interface ResultRow {
  readonly id: string;
  readonly position: number;
  readonly label: string;
  readonly fileKey: string;
  readonly status: PageStatus;
  readonly words: number | null;
}

interface Candidate {
  readonly page: ImportPage;
  readonly position: number;
  readonly entry: PageEntry;
  readonly lines: readonly string[];
}

export function countPageWords(text: string): number {
  return computeStatistics({
    lines: text.split('\n').map((line, index) => ({ number: index + 1, text: line, marks: [] })),
  }).words;
}

function splitsWordWith(previous: Candidate | undefined, next: Candidate): boolean {
  if (previous === undefined) return false;
  const last = previous.lines.at(-1);
  const first = next.lines[0];
  return (
    previous.page.fileKey === next.page.fileKey &&
    previous.position + 1 === next.position &&
    last !== undefined &&
    first !== undefined &&
    continuesHyphenation(last, first)
  );
}

export function buildRows(
  pages: readonly ImportPage[],
  entries: Readonly<Record<string, PageEntry>>,
): ResultRow[] {
  const candidates = pages.flatMap((page, index): Candidate[] => {
    const entry = entries[page.id];
    if (entry === undefined) return [];
    return [{ page, position: index + 1, entry, lines: entry.text.split('\n') }];
  });
  return candidates.map((candidate, index) => {
    const { page, entry } = candidate;
    let words: number | null = null;
    if (entry.hasTranscript) {
      const previous = candidates[index - 1];
      const carried = previous?.entry.hasTranscript && splitsWordWith(previous, candidate);
      words = countPageWords(entry.text) - (carried ? 1 : 0);
    }
    return {
      id: page.id,
      position: candidate.position,
      label: page.label,
      fileKey: page.fileKey,
      status: entry.status,
      words,
    };
  });
}

export function totalWords(rows: readonly ResultRow[]): number {
  return rows.reduce((sum, row) => sum + (row.words ?? 0), 0);
}

export function countedPages(rows: readonly ResultRow[]): number {
  return rows.filter((row) => row.words !== null).length;
}

export function formatCount(count: number): string {
  return count.toLocaleString('de-DE');
}

export function wordsText(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'Wort' : 'Wörter'}`;
}

export function pagesText(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'Seite' : 'Seiten'}`;
}

export function formatSummary(rows: readonly ResultRow[], pageCount: number): string {
  const lines = rows.map(
    (row) =>
      `Seite ${row.position} (${row.label}): ${row.words === null ? 'Nicht erkannt' : wordsText(row.words)}`,
  );
  const counted = countedPages(rows);
  const scope = counted < pageCount ? ` (${counted} von ${pageCount} Seiten)` : '';
  return ['Wortzählung', ...lines, `Gesamt${scope}: ${wordsText(totalWords(rows))}`].join('\n');
}
