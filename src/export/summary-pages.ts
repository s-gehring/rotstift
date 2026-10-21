import type { PDFDocument } from 'pdf-lib';
import { CATALOG, findErrorKind } from '../annotations/catalog.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';
import { gradeColumn, type GradeScale } from '../stats/grading.ts';
import type { Statistics } from '../stats/statistics.ts';
import { formatWeighted, type WeightedStatistics } from '../stats/weighting.ts';
import { COLORS, Sheet, type Fonts } from './sheet.ts';
import type { ContentReport } from './types.ts';
import { formatDate, formatDecimal } from './text.ts';

const DASH = '–';
const ROW = 22;

interface Heading {
  readonly label: string;
  readonly title: string;
}

function drawHeading(sheet: Sheet, { label, title }: Heading): void {
  sheet.text(label.toUpperCase(), sheet.left, sheet.y, { size: 9, bold: true, color: COLORS.ink });
  sheet.y -= 30;
  sheet.text(title, sheet.left, sheet.y, { size: 22, bold: true, maxWidth: sheet.width });
  sheet.y -= 16;
  sheet.rule(sheet.y, COLORS.ink, 1.5);
  sheet.y -= 26;
}

function drawFacts(sheet: Sheet, facts: readonly (readonly [string, string])[]): void {
  for (const [label, value] of facts) {
    sheet.text(label, sheet.left, sheet.y, { size: 10.5, color: COLORS.muted });
    sheet.text(value, sheet.left + 70, sheet.y, {
      size: 10.5,
      bold: true,
      maxWidth: sheet.width - 70,
    });
    sheet.y -= 17;
  }
  sheet.y -= 10;
}

type Figure = readonly [label: string, value: string, note?: string];

function drawFigures(sheet: Sheet, figures: readonly Figure[]): void {
  const gap = 14;
  const boxWidth = (sheet.width - gap * (figures.length - 1)) / figures.length;
  const boxHeight = 72;
  figures.forEach(([label, value, note], index) => {
    const x = sheet.left + index * (boxWidth + gap);
    sheet.rect(x, sheet.y - boxHeight, boxWidth, boxHeight, COLORS.track);
    sheet.text(label, x + 12, sheet.y - 22, {
      size: 9.5,
      color: COLORS.muted,
      maxWidth: boxWidth - 24,
    });
    sheet.text(value, x + 12, sheet.y - 54, { size: 28, bold: true, color: COLORS.ink });
    if (note !== undefined) {
      sheet.text(note, x + 12, sheet.y - 66, {
        size: 8.5,
        color: COLORS.muted,
        maxWidth: boxWidth - 24,
      });
    }
  });
  sheet.y -= boxHeight + 30;
}

function drawFooter(sheet: Sheet): void {
  sheet.text('Erstellt mit Rotstift', sheet.left, sheet.bottom - 20, {
    size: 8.5,
    color: COLORS.muted,
  });
}

interface TypeRow {
  readonly code: string;
  readonly name: string;
  readonly count: number;
}

function typeRows(profile: CorrectionProfile, statistics: Statistics): TypeRow[] {
  const known = CATALOG[profile.language].kinds.map((kind) => kind.code);
  const unknown = Object.keys(statistics.errorsByType).filter((code) => !known.includes(code));
  return [...known, ...unknown]
    .map((code) => ({
      code,
      name: findErrorKind(profile.language, code)?.name ?? code,
      count: statistics.errorsByType[code] ?? 0,
    }))
    .filter((row) => row.count > 0);
}

function profileLabel(profile: CorrectionProfile): string {
  const language = CATALOG[profile.language].name;
  return profile.name === language ? profile.name : `${profile.name} (${language})`;
}

export interface Grade {
  readonly value: string;
  readonly scale: GradeScale;
}

export interface StatisticsPageInput {
  readonly title: string;
  readonly profile: CorrectionProfile;
  readonly statistics: Statistics;
  readonly weighted: WeightedStatistics;
  readonly grade: Grade | null;
  readonly date: Date;
  readonly content?: ContentReport;
}

function drawContent(sheet: Sheet, content: ContentReport): void {
  sheet.y -= 18;
  sheet.ensure(60);
  sheet.text('Inhalt und Form', sheet.left, sheet.y, { size: 13, bold: true });
  sheet.y -= 12;
  sheet.rule(sheet.y);
  sheet.y -= ROW - 4;
  if (content.comments.length === 0) {
    sheet.text('Keine Auffälligkeiten.', sheet.left, sheet.y, { size: 11, color: COLORS.muted });
    sheet.y -= ROW;
    return;
  }
  for (const comment of content.comments) {
    sheet.ensure(ROW);
    sheet.text(`S. ${comment.page}, Z. ${comment.line}`, sheet.left, sheet.y, {
      size: 10.5,
      color: COLORS.muted,
    });
    const text =
      comment.coveredBy === undefined
        ? comment.text
        : `${comment.text} (siehe ${comment.coveredBy})`;
    sheet.text(text, sheet.left + 80, sheet.y, { size: 11, maxWidth: sheet.width - 80 });
    sheet.y -= ROW;
  }
  if (content.summary !== null) {
    sheet.y -= 6;
    sheet.paragraph(content.summary, sheet.left, sheet.width, { size: 11 }, 16);
  }
}

export function drawStatisticsPage(
  doc: PDFDocument,
  fonts: Fonts,
  { title, profile, statistics, weighted, grade, date, content }: StatisticsPageInput,
): void {
  const sheet = new Sheet(doc, fonts);
  drawHeading(sheet, { label: 'Auswertung', title });
  drawFacts(sheet, [
    ['Profil', profileLabel(profile)],
    ['Datum', formatDate(date)],
  ]);
  drawFigures(sheet, [
    ['Wörter', String(statistics.words)],
    ['Fehler', String(statistics.errors), `${formatWeighted(weighted.weighted)} gewichtet`],
    ['Fehlerquotient', formatDecimal(weighted.quotient)],
    ...(grade === null ? [] : [[gradeColumn(grade.scale), grade.value] as const]),
  ]);
  sheet.text('Fehler nach Art', sheet.left, sheet.y, { size: 13, bold: true });
  sheet.y -= 12;
  sheet.rule(sheet.y);
  sheet.y -= ROW - 4;
  const rows = typeRows(profile, statistics);
  if (rows.length === 0) {
    sheet.text('Keine Fehler markiert.', sheet.left, sheet.y, { size: 11, color: COLORS.muted });
  }
  const peak = Math.max(1, ...rows.map((row) => row.count));
  const barLeft = sheet.left + 210;
  const barWidth = sheet.right - 40 - barLeft;
  for (const row of rows) {
    sheet.ensure(ROW);
    sheet.text(row.code, sheet.left, sheet.y, { size: 11, bold: true, color: COLORS.ink });
    sheet.text(row.name, sheet.left + 34, sheet.y, { size: 11, maxWidth: 168 });
    sheet.rect(barLeft, sheet.y - 2, barWidth, 9, COLORS.track);
    sheet.rect(barLeft, sheet.y - 2, Math.max(2, (row.count / peak) * barWidth), 9, COLORS.ink);
    sheet.text(String(row.count), sheet.right, sheet.y, { size: 11, bold: true, align: 'right' });
    sheet.y -= ROW;
  }
  if (rows.length === 0) sheet.y -= ROW;
  if (content !== undefined) drawContent(sheet, content);
  drawFooter(sheet);
}

export interface WordCountPageInput {
  readonly title: string;
  readonly words: readonly (number | undefined)[];
  readonly total: number | undefined;
  readonly note: string | undefined;
  readonly date: Date;
}

const figure = (count: number | undefined) => (count === undefined ? DASH : String(count));

function drawTableHead(
  sheet: Sheet,
  columns: readonly (readonly [string, number, boolean])[],
): void {
  for (const [label, x, alignRight] of columns) {
    sheet.text(label, x, sheet.y, {
      size: 9.5,
      bold: true,
      color: COLORS.muted,
      align: alignRight ? 'right' : 'left',
    });
  }
  sheet.y -= 8;
  sheet.rule(sheet.y);
  sheet.y -= ROW - 6;
}

export function drawWordCountPage(
  doc: PDFDocument,
  fonts: Fonts,
  { title, words, total, note, date }: WordCountPageInput,
): void {
  const sheet = new Sheet(doc, fonts, (next) => {
    drawTableHead(next, [
      ['Seite', next.left, false],
      ['Wörter', next.right, true],
    ]);
  });
  drawHeading(sheet, { label: 'Wortzahl', title });
  drawFacts(sheet, [['Datum', formatDate(date)]]);
  drawFigures(sheet, [['Wörter gesamt', figure(total)]]);
  if (note !== undefined) {
    sheet.y += 14;
    sheet.text(note, sheet.left, sheet.y, { size: 10.5, color: COLORS.muted });
    sheet.y -= 26;
  }
  drawTableHead(sheet, [
    ['Seite', sheet.left, false],
    ['Wörter', sheet.right, true],
  ]);
  words.forEach((count, index) => {
    sheet.ensure(ROW);
    sheet.text(`Seite ${index + 1}`, sheet.left, sheet.y, { size: 11 });
    sheet.text(figure(count), sheet.right, sheet.y, { size: 11, bold: true, align: 'right' });
    sheet.y -= ROW;
  });
  sheet.ensure(ROW);
  sheet.rule(sheet.y + ROW - 8, COLORS.text, 1);
  sheet.text('Gesamt', sheet.left, sheet.y, { size: 11, bold: true });
  sheet.text(figure(total), sheet.right, sheet.y, { size: 11, bold: true, align: 'right' });
  drawFooter(sheet);
}

export interface CoverEntry {
  readonly name: string;
  readonly pages: number;
  readonly words: number | undefined;
  readonly errors: number | undefined;
  readonly weighted?: WeightedStatistics;
  readonly grade?: string;
  readonly note?: string;
}

export interface CoverPageInput {
  readonly title: string;
  readonly entries: readonly CoverEntry[];
  readonly total: CoverEntry;
  readonly date: Date;
  readonly quotients: boolean;
  readonly scale: GradeScale | null;
}

type CoverCell = (entry: CoverEntry) => string;

interface CoverColumn {
  readonly label: string;
  readonly width: number;
  readonly cell: CoverCell;
}

const quotientCell: CoverCell = (entry) =>
  entry.weighted === undefined ? DASH : formatDecimal(entry.weighted.quotient);

function coverColumns(quotients: boolean, scale: GradeScale | null): readonly CoverColumn[] {
  return [
    { label: 'Seiten', width: 60, cell: (entry) => String(entry.pages) },
    { label: 'Wörter', width: 70, cell: (entry) => figure(entry.words) },
    { label: 'Fehler', width: 60, cell: (entry) => figure(entry.errors) },
    ...(quotients ? [{ label: 'Fehlerquotient', width: 90, cell: quotientCell }] : []),
    ...(scale === null
      ? []
      : [{ label: gradeColumn(scale), width: 55, cell: (entry: CoverEntry) => entry.grade ?? '' }]),
  ];
}

function columnRights(sheet: Sheet, columns: readonly CoverColumn[]): number[] {
  const rights: number[] = [];
  let right = sheet.right;
  for (let index = columns.length - 1; index >= 0; index -= 1) {
    rights[index] = right;
    right -= columns[index]?.width ?? 0;
  }
  return rights;
}

function coverHead(sheet: Sheet, columns: readonly CoverColumn[]) {
  const rights = columnRights(sheet, columns);
  return [
    ['Name', sheet.left, false] as const,
    ...columns.map((column, index) => [column.label, rights[index] ?? sheet.right, true] as const),
  ];
}

function drawCoverRow(
  sheet: Sheet,
  columns: readonly CoverColumn[],
  entry: CoverEntry,
  bold = false,
): void {
  sheet.ensure(entry.note === undefined ? ROW : ROW + 12);
  const rights = columnRights(sheet, columns);
  const nameWidth = (rights[0] ?? sheet.right) - (columns[0]?.width ?? 0) - sheet.left;
  sheet.text(entry.name, sheet.left, sheet.y, { size: 11, bold, maxWidth: nameWidth });
  columns.forEach((column, index) => {
    sheet.text(column.cell(entry), rights[index] ?? sheet.right, sheet.y, {
      size: 11,
      bold: bold || index >= 2,
      align: 'right',
    });
  });
  sheet.y -= ROW;
  if (entry.note !== undefined) {
    sheet.text(entry.note, sheet.left, sheet.y + 8, { size: 9, color: COLORS.muted });
    sheet.y -= 12;
  }
}

export function drawCoverPage(
  doc: PDFDocument,
  fonts: Fonts,
  { title, entries, total, date, quotients, scale }: CoverPageInput,
): void {
  const columns = coverColumns(quotients, scale);
  const sheet = new Sheet(doc, fonts, (next) => drawTableHead(next, coverHead(next, columns)));
  drawHeading(sheet, { label: 'Klassenübersicht', title });
  drawFacts(sheet, [
    ['Datum', formatDate(date)],
    ['Arbeiten', String(entries.length)],
  ]);
  drawTableHead(sheet, coverHead(sheet, columns));
  for (const entry of entries) drawCoverRow(sheet, columns, entry);
  sheet.rule(sheet.y + ROW - 8, COLORS.text, 1);
  drawCoverRow(sheet, columns, total, true);
  drawFooter(sheet);
}
