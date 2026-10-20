import type { PDFDocument } from 'pdf-lib';
import { CATALOG, findErrorKind } from '../annotations/catalog.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';
import type { Statistics } from '../stats/statistics.ts';
import { COLORS, Sheet, type Fonts } from './sheet.ts';
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

function drawFigures(sheet: Sheet, figures: readonly (readonly [string, string])[]): void {
  const gap = 14;
  const boxWidth = (sheet.width - gap * (figures.length - 1)) / figures.length;
  const boxHeight = 72;
  figures.forEach(([label, value], index) => {
    const x = sheet.left + index * (boxWidth + gap);
    sheet.rect(x, sheet.y - boxHeight, boxWidth, boxHeight, COLORS.track);
    sheet.text(label, x + 12, sheet.y - 22, {
      size: 9.5,
      color: COLORS.muted,
      maxWidth: boxWidth - 24,
    });
    sheet.text(value, x + 12, sheet.y - 54, { size: 28, bold: true, color: COLORS.ink });
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

export interface StatisticsPageInput {
  readonly title: string;
  readonly profile: CorrectionProfile;
  readonly statistics: Statistics;
  readonly date: Date;
}

export function drawStatisticsPage(
  doc: PDFDocument,
  fonts: Fonts,
  { title, profile, statistics, date }: StatisticsPageInput,
): void {
  const sheet = new Sheet(doc, fonts);
  drawHeading(sheet, { label: 'Auswertung', title });
  drawFacts(sheet, [
    ['Profil', profileLabel(profile)],
    ['Datum', formatDate(date)],
  ]);
  drawFigures(sheet, [
    ['Wörter', String(statistics.words)],
    ['Fehler gesamt', String(statistics.errors)],
    ['Fehler pro 100 Wörter', formatDecimal(statistics.errorsPer100Words)],
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
  drawFooter(sheet);
}

export interface WordCountPageInput {
  readonly title: string;
  readonly words: readonly (number | undefined)[];
  readonly date: Date;
}

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
  { title, words, date }: WordCountPageInput,
): void {
  const total = words.reduce<number>((sum, count) => sum + (count ?? 0), 0);
  const sheet = new Sheet(doc, fonts, (next) => {
    drawTableHead(next, [
      ['Seite', next.left, false],
      ['Wörter', next.right, true],
    ]);
  });
  drawHeading(sheet, { label: 'Wortzahl', title });
  drawFacts(sheet, [['Datum', formatDate(date)]]);
  drawFigures(sheet, [['Wörter gesamt', String(total)]]);
  drawTableHead(sheet, [
    ['Seite', sheet.left, false],
    ['Wörter', sheet.right, true],
  ]);
  words.forEach((count, index) => {
    sheet.ensure(ROW);
    sheet.text(`Seite ${index + 1}`, sheet.left, sheet.y, { size: 11 });
    sheet.text(count === undefined ? DASH : String(count), sheet.right, sheet.y, {
      size: 11,
      bold: true,
      align: 'right',
    });
    sheet.y -= ROW;
  });
  sheet.ensure(ROW);
  sheet.rule(sheet.y + ROW - 8, COLORS.text, 1);
  sheet.text('Gesamt', sheet.left, sheet.y, { size: 11, bold: true });
  sheet.text(String(total), sheet.right, sheet.y, { size: 11, bold: true, align: 'right' });
  drawFooter(sheet);
}

export interface CoverEntry {
  readonly name: string;
  readonly pages: number;
  readonly words: number;
  readonly errors: number | undefined;
}

export interface CoverPageInput {
  readonly title: string;
  readonly entries: readonly CoverEntry[];
  readonly date: Date;
}

const coverColumns = (sheet: Sheet) =>
  [
    ['Name', sheet.left, false],
    ['Seiten', sheet.right - 170, true],
    ['Wörter', sheet.right - 90, true],
    ['Fehler', sheet.right, true],
  ] as const;

export function drawCoverPage(
  doc: PDFDocument,
  fonts: Fonts,
  { title, entries, date }: CoverPageInput,
): void {
  const sheet = new Sheet(doc, fonts, (next) => drawTableHead(next, coverColumns(next)));
  drawHeading(sheet, { label: 'Klassenübersicht', title });
  drawFacts(sheet, [
    ['Datum', formatDate(date)],
    ['Arbeiten', String(entries.length)],
  ]);
  drawTableHead(sheet, coverColumns(sheet));
  for (const entry of entries) {
    sheet.ensure(ROW);
    sheet.text(entry.name, sheet.left, sheet.y, { size: 11, maxWidth: sheet.width - 200 });
    sheet.text(String(entry.pages), sheet.right - 170, sheet.y, { size: 11, align: 'right' });
    sheet.text(String(entry.words), sheet.right - 90, sheet.y, { size: 11, align: 'right' });
    sheet.text(entry.errors === undefined ? DASH : String(entry.errors), sheet.right, sheet.y, {
      size: 11,
      bold: true,
      align: 'right',
    });
    sheet.y -= ROW;
  }
  drawFooter(sheet);
}
