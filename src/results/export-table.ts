import {
  incompleteArbeitenNote,
  incompletePagesNote,
  uncorrectedArbeitenNote,
  uncorrectedPagesNote,
} from '../export/notes.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';
import {
  combineStatistics,
  formatRate,
  weighArbeit,
  weighClass,
  type ArbeitReview,
} from '../review/summary.ts';
import type { Statistics } from '../stats/statistics.ts';
import { formatWeighted, type WeightedStatistics, type Weighting } from '../stats/weighting.ts';
import { classTotals, isComplete, type ArbeitResult } from './summary.ts';

export interface CorrectionColumns {
  readonly types: readonly string[];
  readonly arbeiten: readonly ArbeitReview[];
  readonly profile: CorrectionProfile;
  readonly weighting: Weighting;
}

const BOM = '﻿';
const FORMULA_START = /^[=+\-@\t\r]/u;
const NO_ERRORS: Statistics = { words: 0, errors: 0, errorsByType: {}, errorsPer100Words: 0 };
const NO_WEIGHTED: WeightedStatistics = { words: 0, weighted: 0, quotient: 0 };

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

function header(corrections: CorrectionColumns | undefined): string[] {
  const errors =
    corrections === undefined
      ? []
      : [
          'Fehler',
          'Fehler je 100 Wörter',
          'Gewichtete Fehler',
          'Fehlerquotient',
          ...corrections.types,
        ];
  return ['Name', 'Seiten', 'Wörter', ...errors, 'Hinweis'];
}

function errorCells(
  statistics: Statistics | null,
  weighted: WeightedStatistics | null,
  types: readonly string[],
): string[] {
  if (statistics === null || weighted === null) return ['', '', '', '', ...types.map(() => '')];
  return [
    String(statistics.errors),
    formatRate(statistics.errorsPer100Words),
    formatWeighted(weighted.weighted),
    formatRate(weighted.quotient),
    ...types.map((type) => String(statistics.errorsByType[type] ?? 0)),
  ];
}

function cells(result: ArbeitResult, corrections: CorrectionColumns | undefined): string[] {
  const complete = isComplete(result);
  const words = complete ? String(result.words) : '';
  const countNote = complete ? '' : incompletePagesNote(result.countedPages, result.pageCount);
  if (corrections === undefined) return [result.name, String(result.pageCount), words, countNote];
  const review = corrections.arbeiten.find((candidate) => candidate.id === result.id);
  const corrected = review?.complete === true;
  return [
    result.name,
    String(result.pageCount),
    words,
    ...errorCells(
      corrected ? (review.statistics ?? NO_ERRORS) : null,
      corrected
        ? (weighArbeit(review, corrections.profile, corrections.weighting) ?? NO_WEIGHTED)
        : null,
      corrections.types,
    ),
    corrected
      ? countNote
      : uncorrectedPagesNote((review?.corrected ?? 0) + (review?.empty ?? 0), result.pageCount),
  ];
}

function totalCells(
  results: readonly ArbeitResult[],
  corrections: CorrectionColumns | undefined,
): string[] {
  const totals = classTotals(results);
  const complete = totals.completeArbeiten === totals.arbeiten;
  const words = complete ? String(totals.words) : '';
  const countNote = complete
    ? ''
    : incompleteArbeitenNote(totals.completeArbeiten, totals.arbeiten);
  if (corrections === undefined) return ['Gesamt', String(totals.pages), words, countNote];
  const corrected = corrections.arbeiten.filter((review) => review.complete);
  const allCorrected = corrected.length === results.length;
  const statistics = combineStatistics(corrected.flatMap((review) => review.statistics ?? []));
  return [
    'Gesamt',
    String(totals.pages),
    words,
    ...errorCells(
      allCorrected ? (statistics ?? NO_ERRORS) : null,
      allCorrected
        ? (weighClass(corrected, corrections.profile, corrections.weighting) ?? NO_WEIGHTED)
        : null,
      corrections.types,
    ),
    allCorrected ? countNote : uncorrectedArbeitenNote(corrected.length, results.length),
  ];
}

function tableRows(
  results: readonly ArbeitResult[],
  corrections: CorrectionColumns | undefined,
): string[][] {
  return [
    header(corrections),
    ...results.map((result) => cells(result, corrections)),
    totalCells(results, corrections),
  ];
}

export function formatCsv(
  results: readonly ArbeitResult[],
  corrections?: CorrectionColumns,
): string {
  const lines = tableRows(results, corrections).map((row) => row.map(csvField).join(';'));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

export function formatClipboardTable(
  results: readonly ArbeitResult[],
  corrections?: CorrectionColumns,
): string {
  return tableRows(results, corrections)
    .map((row) => row.map(tsvField).join('\t'))
    .join('\n');
}

export function csvFileName(corrections?: CorrectionColumns): string {
  return corrections === undefined ? 'Wortzahlen' : 'Klassenübersicht';
}
