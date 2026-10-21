import { incompleteArbeitenNote, incompletePagesNote } from '../export/notes.ts';
import { classTotals, isComplete, type ArbeitResult } from './summary.ts';

const BOM = '\uFEFF';
const HEADER = ['Name', 'Seiten', 'Wörter', 'Hinweis'] as const;
const FORMULA_START = /^[=+\-@\t\r]/u;

function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

function csvField(value: string): string {
  const safe = neutralizeFormula(value);
  return /[;"\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function tsvField(value: string): string {
  return neutralizeFormula(value).replace(/[\t\r\n]+/gu, ' ');
}

function cells(result: ArbeitResult): string[] {
  const complete = isComplete(result);
  return [
    result.name,
    String(result.pageCount),
    complete ? String(result.words) : '',
    complete ? '' : incompletePagesNote(result.countedPages, result.pageCount),
  ];
}

function totalCells(results: readonly ArbeitResult[]): string[] {
  const totals = classTotals(results);
  const complete = totals.completeArbeiten === totals.arbeiten;
  return [
    'Gesamt',
    String(totals.pages),
    complete ? String(totals.words) : '',
    complete ? '' : incompleteArbeitenNote(totals.completeArbeiten, totals.arbeiten),
  ];
}

function tableRows(results: readonly ArbeitResult[]): string[][] {
  return [[...HEADER], ...results.map(cells), totalCells(results)];
}

export function formatCsv(results: readonly ArbeitResult[]): string {
  const lines = tableRows(results).map((row) => row.map(csvField).join(';'));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

export function formatClipboardTable(results: readonly ArbeitResult[]): string {
  return tableRows(results)
    .map((row) => row.map(tsvField).join('\t'))
    .join('\n');
}

export const CSV_FILE_NAME = 'Wortzahlen';
