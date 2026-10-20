import type { Arbeit } from '../import/arbeiten.ts';
import type { PageEntry, PageStatus } from '../pipeline/runner.ts';
import { continuesHyphenation, computeStatistics } from '../stats/statistics.ts';

export interface ResultRow {
  readonly id: string;
  readonly position: number;
  readonly label: string;
  readonly status: PageStatus;
  readonly words: number | null;
}

export interface ArbeitResult {
  readonly id: string;
  readonly name: string;
  readonly pageCount: number;
  readonly rows: readonly ResultRow[];
  readonly words: number;
  readonly countedPages: number;
}

export interface ClassTotals {
  readonly arbeiten: number;
  readonly pages: number;
  readonly countedPages: number;
  readonly words: number;
  readonly completeArbeiten: number;
  readonly average: number | null;
}

interface Candidate {
  readonly id: string;
  readonly label: string;
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
    previous.entry.hasTranscript &&
    previous.position + 1 === next.position &&
    last !== undefined &&
    first !== undefined &&
    continuesHyphenation(last, first)
  );
}

function buildArbeitResult(arbeit: Arbeit, entries: Readonly<Record<string, PageEntry>>) {
  const candidates = arbeit.pages.flatMap((page, index): Candidate[] => {
    const entry = entries[page.id];
    if (entry === undefined) return [];
    return [
      { id: page.id, label: page.label, position: index + 1, entry, lines: entry.text.split('\n') },
    ];
  });
  const rows = candidates.map((candidate, index): ResultRow => {
    const { entry } = candidate;
    let words: number | null = null;
    if (entry.hasTranscript) {
      const carried = splitsWordWith(candidates[index - 1], candidate);
      words = countPageWords(entry.text) - (carried ? 1 : 0);
    }
    return {
      id: candidate.id,
      position: candidate.position,
      label: candidate.label,
      status: entry.status,
      words,
    };
  });
  return {
    id: arbeit.id,
    name: arbeit.name,
    pageCount: arbeit.pages.length,
    rows,
    words: totalWords(rows),
    countedPages: countedPages(rows),
  };
}

export function buildResults(
  arbeiten: readonly Arbeit[],
  entries: Readonly<Record<string, PageEntry>>,
): ArbeitResult[] {
  return arbeiten.map((arbeit) => buildArbeitResult(arbeit, entries));
}

export function isComplete(result: ArbeitResult): boolean {
  return result.countedPages === result.pageCount;
}

export function totalWords(rows: readonly ResultRow[]): number {
  return rows.reduce((sum, row) => sum + (row.words ?? 0), 0);
}

export function countedPages(rows: readonly ResultRow[]): number {
  return rows.filter((row) => row.words !== null).length;
}

export function classTotals(results: readonly ArbeitResult[]): ClassTotals {
  const complete = results.filter(isComplete);
  const completeWords = complete.reduce((sum, result) => sum + result.words, 0);
  return {
    arbeiten: results.length,
    pages: results.reduce((sum, result) => sum + result.pageCount, 0),
    countedPages: results.reduce((sum, result) => sum + result.countedPages, 0),
    words: results.reduce((sum, result) => sum + result.words, 0),
    completeArbeiten: complete.length,
    average: complete.length === 0 ? null : completeWords / complete.length,
  };
}

export function formatCount(count: number): string {
  return count.toLocaleString('de-DE');
}

export function formatAverage(average: number): string {
  return average.toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

export function wordsText(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'Wort' : 'Wörter'}`;
}

export function pagesText(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'Seite' : 'Seiten'}`;
}

export function arbeitenText(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'Arbeit' : 'Arbeiten'}`;
}
