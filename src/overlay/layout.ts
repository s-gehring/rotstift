import { findErrorKind } from '../annotations/catalog.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';
import type { Mark, Transcript, TranscriptLine } from '../annotations/transcript.ts';
import { estimateTextWidth, FIX_EM_PER_UNIT, textUnits } from './char-width.ts';
import {
  bendPath,
  frameLift,
  gapAbove,
  lineAngleAt,
  lineTopAt,
  placeLine,
  type LineFrame,
  type PlacedLine,
} from './geometry.ts';
import { proportionalLocator, type TextLocator, type XSpan } from './locator.ts';
import { marginX } from './margins.ts';
import type {
  OverlayItem,
  OverlayModel,
  PageMargins,
  PageSize,
  StrokeItem,
  TextItem,
} from './model.ts';
import { fitRow, sizeLadder } from './pack.ts';
import { createRandom, seedFor, spread } from './random.ts';
import { caret, clampPath, hand, ring } from './strokes.ts';

export interface PageComment {
  readonly line: number;
  readonly text: string;
}

export interface LayoutOptions {
  readonly page: PageSize;
  readonly profile: CorrectionProfile;
  readonly locator?: TextLocator;
  readonly comments?: readonly PageComment[];
  readonly summary?: string | null;
  readonly margins?: PageMargins;
}

type LocatedLine = PlacedLine;

type Column =
  | {
      readonly mode: 'margin';
      readonly side: 'left' | 'right';
      readonly left: number;
      readonly right: number;
    }
  | { readonly mode: 'edge'; readonly right: number };

interface Frame {
  readonly page: PageSize;
  readonly pad: number;
  readonly inset: number;
  readonly textLeft: number;
  readonly column: Column;
  readonly fallback: Column;
  readonly obstacles: readonly Box[];
}

interface Entry {
  readonly index: number;
  readonly mark: Mark;
  readonly code: string;
  readonly title: string;
  readonly span: XSpan;
}

interface FixText {
  readonly entry: Entry;
  readonly text: string;
  readonly boost: number;
}

const SHORT_WORD_LENGTH = 4;
const BASELINE = 0.78;
const UNDERLINE = 0.9;
const STRIKE = 0.6;
const FIX_PREFERRED = 0.66;
const FIX_ASCENT = 0.8;
const FIX_LIFT = 0.04;
const FIX_GAP_EM = 0.45;
const CODE_PREFERRED = 0.7;
const MIN_FIX_FRACTION = 0.3;
const MIN_FIX_PIXELS = 9;
const MIN_CODE_FRACTION = 0.4;
const MIN_EDGE_CODE_PIXELS = 6;
const EDGE_INSET_FRACTION = 0.1;
const WIDTH_SAFETY = 1.06;
const CODE_CENTER = 0.5;
const CODE_DROP = 0.3;
const RULED_GAP = 0.2;
const RULED_MIN_WIDTH = 0.3;
const RULED_RIGHT_AFTER = 0.5;
const RULED_RETRIES = 3;

function hasBox(
  line: TranscriptLine,
): line is TranscriptLine & { readonly bbox: NonNullable<TranscriptLine['bbox']> } {
  return line.bbox !== undefined;
}

export function layoutOverlay(transcript: Transcript, options: LayoutOptions): OverlayModel {
  const { page, profile } = options;
  if (!(page.width > 0) || !(page.height > 0)) {
    throw new RangeError('Die Seitengröße muss größer als 0 sein.');
  }
  const locator = options.locator ?? proportionalLocator;
  const lines = transcript.lines.filter(hasBox).flatMap(placeLine);
  const skippedLines = transcript.lines
    .filter((line) => !hasBox(line) && line.marks.length > 0)
    .map((line) => line.number);
  const frame = buildFrame(page, lines, options.margins);
  const items: OverlayItem[] = [];
  let previous: LineFrame | null = null;
  for (const line of lines) {
    if (line.marks.length > 0) {
      items.push(...layoutLine(line, previous, frame, profile, locator));
    }
    previous = line.frame;
  }
  const placed = items.map((item) => (item.kind === 'text' ? keepInPage(item, frame) : item));
  const taken = placed.flatMap((item) => (item.kind === 'text' ? [textBox(item)] : []));
  const notes = [
    ...commentItems(lines, frame, options.comments ?? [], [...taken, ...frame.obstacles]),
    ...summaryItems(lines, frame, options.summary ?? null),
  ];
  return {
    page,
    items: [...placed, ...notes.map((item) => keepInPage(item, frame))],
    skippedLines,
  };
}

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const COMMENT_PREFERRED = 0.6;
const COMMENT_MAX_ROWS = 3;
const COMMENT_SEARCH_LINES = 3;
const SIGN_TEXT = '*';
const SUMMARY_PREFERRED = 0.62;
const SUMMARY_MIN = 0.4;
const SUMMARY_GAP = 0.7;
const SUMMARY_MAX_ROWS = 4;
const DESCENT = 0.25;

function textBox(item: TextItem): Box {
  const width = estimateTextWidth(item.text, item.size) * WIDTH_SAFETY;
  const share = item.anchor === 'end' ? 1 : item.anchor === 'middle' ? 0.5 : 0;
  const left = item.x - width * share;
  return {
    left,
    right: left + width,
    top: item.y - item.size * FIX_ASCENT,
    bottom: item.y + item.size * DESCENT,
  };
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function wrapWords(
  text: string,
  size: number,
  available: number,
  maxRows: number,
): string[] | null {
  const rows: string[] = [];
  let row = '';
  for (const word of text.split(' ').filter(Boolean)) {
    const candidate = row === '' ? word : `${row} ${word}`;
    if (fitsAt(candidate, size, available)) {
      row = candidate;
      continue;
    }
    if (row === '' || !fitsAt(word, size, available)) return null;
    rows.push(row);
    row = word;
  }
  if (row !== '') rows.push(row);
  return rows.length > 0 && rows.length <= maxRows ? rows : null;
}

function fitWords(
  text: string,
  preferred: number,
  minimum: number,
  available: number,
  maxRows: number,
): CodeRows | null {
  for (const size of sizeLadder(preferred, Math.min(minimum, preferred))) {
    const rows = wrapWords(text, size, available, maxRows);
    if (rows !== null) return { rows, size };
  }
  return null;
}

function shifts(step: number, reach: number): number[] {
  const result = [0];
  for (let offset = step; offset <= reach; offset += step) result.push(offset, -offset);
  return result;
}

function marginComment(
  line: LocatedLine,
  comment: PageComment,
  frame: Frame,
  taken: readonly Box[],
): TextItem[] | null {
  const { column, page, pad } = frame;
  if (column.mode !== 'margin') return null;
  const height = line.frame.height;
  const random = createRandom(seedFor(line.number, 77, 3));
  const rotate = spread(random, 1) + lineAngleAt(line.frame, column.left);
  const middle = lineTopAt(line.frame, column.left) + height * CODE_CENTER;
  const place = (x: number, shift: number): TextItem[] | null => {
    const fitted = fitWords(
      comment.text,
      height * COMMENT_PREFERRED,
      height * MIN_CODE_FRACTION,
      column.right - x,
      COMMENT_MAX_ROWS,
    );
    if (fitted === null) return null;
    const { rows, size } = fitted;
    const step = size * ROW_HEIGHT_EM;
    const first = middle + size * CODE_DROP - (step * (rows.length - 1)) / 2 + shift;
    return rows.map((text, row) => ({
      kind: 'text',
      role: 'comment',
      text,
      x,
      y: first + row * step,
      size,
      rotate,
      anchor: 'start',
      line: line.number,
      mark: null,
      title: comment.text,
    }));
  };
  for (const shift of shifts(height * 0.5, height * COMMENT_SEARCH_LINES)) {
    let x = column.left;
    while (x < column.right) {
      const items = place(x, shift);
      if (items === null) break;
      const boxes = items.map(textBox);
      if (!boxes.every((box) => box.top >= pad && box.bottom <= page.height - pad)) break;
      const blockers = taken.filter((other) => boxes.some((box) => overlaps(box, other)));
      if (blockers.length === 0) return items;
      x = Math.max(...blockers.map((other) => other.right)) + height * 0.3;
    }
  }
  return null;
}

function signItem(
  line: LocatedLine,
  comment: PageComment,
  frame: Frame,
  taken: readonly Box[],
): TextItem {
  const height = line.frame.height;
  const size = height * CODE_PREFERRED;
  const { column } = frame;
  const y = (x: number) => lineTopAt(line.frame, x) + height * CODE_CENTER + size * CODE_DROP;
  const sign = (x: number, anchor: TextItem['anchor']): TextItem => ({
    kind: 'text',
    role: 'sign',
    text: SIGN_TEXT,
    x,
    y: y(x),
    size,
    rotate: lineAngleAt(line.frame, x),
    anchor,
    line: line.number,
    mark: null,
    title: comment.text,
  });
  const candidates =
    column.mode === 'margin'
      ? [sign(column.right, 'end'), sign(column.left, 'start')]
      : [sign(frame.page.width - frame.inset, 'end')];
  const free = candidates.find((item) => !taken.some((other) => overlaps(textBox(item), other)));
  return free ?? sign(Math.max(frame.pad, line.bbox.x - size * 0.3), 'end');
}

function commentItems(
  lines: readonly LocatedLine[],
  frame: Frame,
  comments: readonly PageComment[],
  taken: readonly Box[],
): TextItem[] {
  const occupied = [...taken];
  const items: TextItem[] = [];
  for (const comment of comments.toSorted((a, b) => a.line - b.line)) {
    const line = lines.find((candidate) => candidate.number === comment.line);
    if (line === undefined) continue;
    const placed = marginComment(line, comment, frame, occupied) ?? [
      signItem(line, comment, frame, occupied),
    ];
    items.push(...placed);
    occupied.push(...placed.map(textBox));
  }
  return items;
}

function summaryItems(
  lines: readonly LocatedLine[],
  frame: Frame,
  summary: string | null,
): TextItem[] {
  if (summary === null || summary.trim() === '' || lines.length === 0) return [];
  const meanHeight = lines.reduce((sum, line) => sum + line.frame.height, 0) / lines.length;
  const bottom = Math.max(...lines.map((line) => line.bbox.y + line.bbox.height));
  const textRight = Math.max(...lines.map((line) => line.bbox.x + line.bbox.width));
  const fitted = fitWords(
    summary,
    meanHeight * SUMMARY_PREFERRED,
    meanHeight * SUMMARY_MIN,
    Math.min(textRight, frame.page.width - frame.inset) - frame.textLeft,
    SUMMARY_MAX_ROWS,
  );
  if (fitted === null) return [];
  const { rows, size } = fitted;
  const step = size * ROW_HEIGHT_EM;
  const first = bottom + meanHeight * SUMMARY_GAP + size * FIX_ASCENT;
  if (first + step * (rows.length - 1) + size * DESCENT > frame.page.height - frame.pad) return [];
  const random = createRandom(seedFor(lines.length, 55, rows.length));
  const rotate = spread(random, 0.6);
  return rows.map((text, row) => ({
    kind: 'text',
    role: 'summary',
    text,
    x: frame.textLeft,
    y: first + row * step,
    size,
    rotate,
    anchor: 'start',
    line: 0,
    mark: null,
    title: summary,
  }));
}

function keepInPage(item: TextItem, frame: Frame): TextItem {
  const { page, pad } = frame;
  const room = page.width - 2 * pad;
  let size = item.size;
  let width = estimateTextWidth(item.text, size) * WIDTH_SAFETY;
  if (width > room) {
    size *= room / width;
    width = room;
  }
  const anchorShare = item.anchor === 'end' ? 1 : item.anchor === 'middle' ? 0.5 : 0;
  const left = item.x - width * anchorShare;
  const x = item.x + Math.min(Math.max(left, pad), page.width - pad - width) - left;
  const rise = Math.abs(Math.sin((item.rotate * Math.PI) / 180)) * width;
  const y = Math.min(
    Math.max(item.y, pad + size * FIX_ASCENT + rise),
    page.height - pad - size * 0.25 - rise,
  );
  return x === item.x && y === item.y && size === item.size ? item : { ...item, x, y, size };
}

function buildFrame(
  page: PageSize,
  lines: readonly LocatedLine[],
  margins: PageMargins | undefined,
): Frame {
  const pad = Math.max(4, page.width * 0.006);
  if (lines.length === 0) {
    const column: Column = { mode: 'edge', right: page.width - pad };
    return { page, pad, inset: pad, textLeft: pad, column, fallback: column, obstacles: [] };
  }
  const meanHeight = lines.reduce((sum, line) => sum + line.frame.height, 0) / lines.length;
  const inset = Math.max(pad, meanHeight * EDGE_INSET_FRACTION);
  const textLeft = Math.max(Math.min(...lines.map((line) => line.bbox.x)), pad);
  const textRight = Math.min(
    Math.max(...lines.map((line) => line.bbox.x + line.bbox.width)),
    page.width - inset,
  );
  const obstacles = lines.map((line) => ({
    left: line.bbox.x,
    right: line.bbox.x + line.bbox.width,
    top: line.bbox.y,
    bottom: line.bbox.y + line.bbox.height,
  }));
  const fallback = textColumn(page, inset, textLeft, textRight, meanHeight);
  const ruled = ruledColumn(page, lines, margins, inset, pad, meanHeight);
  return { page, pad, inset, textLeft, column: ruled ?? fallback, fallback, obstacles };
}

function textColumn(
  page: PageSize,
  inset: number,
  textLeft: number,
  textRight: number,
  meanHeight: number,
): Column {
  const needed = Math.max(page.width * 0.04, meanHeight * 1.6);
  const freeRight = page.width - textRight - inset;
  const freeLeft = textLeft - inset;
  if (freeRight >= needed) {
    const left = textRight + Math.min(freeRight * 0.2, meanHeight * 0.8);
    return { mode: 'margin', side: 'right', left, right: page.width - inset };
  }
  if (freeLeft >= needed) {
    const right = textLeft - Math.min(freeLeft * 0.2, meanHeight * 0.8);
    return { mode: 'margin', side: 'left', left: inset, right };
  }
  return { mode: 'edge', right: textRight };
}

function ruledColumn(
  page: PageSize,
  lines: readonly LocatedLine[],
  margins: PageMargins | undefined,
  inset: number,
  pad: number,
  meanHeight: number,
): Column | null {
  if (margins === undefined) return null;
  const middles = lines.map((line) => line.bbox.y + line.bbox.height / 2);
  const gap = Math.max(pad, meanHeight * RULED_GAP);
  const needed = meanHeight * RULED_MIN_WIDTH;
  if (margins.right !== null) {
    const line = margins.right;
    const edge = Math.max(...middles.map((y) => marginX(line, y))) + gap;
    if (edge > page.width * RULED_RIGHT_AFTER && page.width - inset - edge >= needed) {
      return { mode: 'margin', side: 'right', left: edge, right: page.width - inset };
    }
  }
  if (margins.left !== null) {
    const line = margins.left;
    const edge = Math.min(...middles.map((y) => marginX(line, y))) - gap;
    if (edge < page.width * (1 - RULED_RIGHT_AFTER) && edge - inset >= needed) {
      return { mode: 'margin', side: 'left', left: inset, right: edge };
    }
  }
  return null;
}

function layoutLine(
  line: LocatedLine,
  previous: LineFrame | null,
  frame: Frame,
  profile: CorrectionProfile,
  locator: TextLocator,
): OverlayItem[] {
  const height = line.frame.height;
  const entries = line.marks.map((mark, k) =>
    toEntry(line, mark, line.markIndices[k] ?? k, profile, locator),
  );
  const items: OverlayItem[] = [];
  for (const entry of entries) {
    items.push(drawMark(line, entry, frame.page));
  }

  const fixes: FixText[] = entries
    .filter((entry) => entry.mark.correction !== '')
    .map((entry) => ({
      entry,
      text: entry.mark.correction,
      boost: /[\p{L}\p{N}]/u.test(entry.mark.correction) ? 1 : 1.9,
    }));

  const gap = Math.max(0, gapAbove(line.frame, previous));
  const bandSize = (gap - height * (FIX_LIFT + 0.02)) / FIX_ASCENT;
  const minFix = Math.max(height * MIN_FIX_FRACTION, MIN_FIX_PIXELS);
  const preferred = Math.min(height * FIX_PREFERRED, bandSize);
  const codeSize = Math.max(Math.min(preferred, height * CODE_PREFERRED), minFix);
  const bandBaseline = (x: number) => lineTopAt(line.frame, x) - height * FIX_LIFT;
  const bandUsable = preferred >= minFix;

  const maxRight = frame.page.width - frame.inset;
  const minLeft =
    frame.column.mode === 'margin' && frame.column.side === 'left'
      ? frame.column.right + frame.pad
      : frame.pad;

  const moved = new Set<number>();
  const rightLimit = (): number => {
    if (frame.column.mode === 'margin') {
      return frame.column.side === 'right' ? frame.column.left - frame.pad : maxRight;
    }
    const codes = fitEdgeCodes(entries, moved, frame, codeSize);
    return (
      frame.column.right - estimateTextWidth(codes.text, codes.size) * WIDTH_SAFETY - codeSize * 1.2
    );
  };

  let remaining = fixes;
  let fitted: ReturnType<typeof fitRow> = null;
  if (bandUsable) {
    const sizes = sizeLadder(preferred, minFix);
    while (remaining.length > 0) {
      const ordered = Array.from(remaining);
      ordered.sort((a, b) => center(a.entry.span) - center(b.entry.span));
      fitted = fitRow(
        ordered.map((fix) => ({
          center: center(fix.entry.span),
          units: textUnits(fix.text) * fix.boost,
        })),
        sizes,
        () => ({ left: minLeft, right: Math.min(rightLimit(), maxRight) }),
        FIX_EM_PER_UNIT,
        FIX_GAP_EM,
      );
      if (fitted !== null) {
        remaining = ordered;
        break;
      }
      const widest = ordered.reduce((a, b) =>
        textUnits(b.text) * b.boost > textUnits(a.text) * a.boost ? b : a,
      );
      moved.add(widest.entry.index);
      remaining = ordered.filter((fix) => fix !== widest);
    }
  } else {
    for (const fix of fixes) moved.add(fix.entry.index);
    remaining = [];
  }

  if (fitted !== null) {
    const result = fitted;
    remaining.forEach((fix, position) => {
      const start = result.starts[position] ?? frame.pad;
      const random = createRandom(seedFor(line.number, fix.entry.index, 7));
      const size = result.size * fix.boost;
      const middle = start + estimateTextWidth(fix.text, size) / 2;
      items.push({
        kind: 'text',
        role: 'fix',
        text: fix.text,
        x: start,
        y: bandBaseline(middle) + spread(random, result.size * 0.05),
        size,
        rotate: spread(random, 1.8) + line.frame.angle(middle),
        anchor: 'start',
        line: line.number,
        mark: fix.entry.index,
        title: `${fix.entry.title}: ${fix.entry.mark.original || '∧'} → ${fix.text}`,
      });
    });
  }

  items.push(
    ...codesItems(line, entries, moved, frame, { codeSize, bandBaseline, bandSize, bandUsable }),
  );
  return items;
}

function center(span: XSpan): number {
  return (span.x0 + span.x1) / 2;
}

function toEntry(
  line: LocatedLine,
  mark: Mark,
  index: number,
  profile: CorrectionProfile,
  locator: TextLocator,
): Entry {
  const kind = findErrorKind(profile.language, mark.type);
  const code = kind?.code ?? mark.type;
  return {
    index,
    mark,
    code,
    title: kind === undefined ? code : `${code} (${kind.name})`,
    span: locator.span(line, mark.offset, mark.offset + mark.original.length),
  };
}

function drawMark(line: LocatedLine, entry: Entry, page: PageSize): StrokeItem {
  const height = line.frame.height;
  const lift = frameLift(line.frame);
  const random = createRandom(seedFor(line.number, entry.index, 3));
  const width = Math.min(Math.max(height * 0.05, 1.2), 3.5);
  const wobble = Math.max(0.5, height * 0.012);
  const x0 = Math.min(Math.max(entry.span.x0, 0), page.width);
  const x1 = Math.min(Math.max(entry.span.x1, 0), page.width);
  const base = {
    kind: 'stroke',
    width,
    line: line.number,
    mark: entry.index,
    title: entry.title,
  } as const;

  const keep = (d: string) =>
    clampPath(
      bendPath(d, line.frame),
      width / 2,
      width / 2,
      page.width - width / 2,
      page.height - width / 2,
    );

  if (entry.mark.kind === 'omission') {
    return {
      ...base,
      role: 'caret',
      d: keep(caret(x0, lift + height * BASELINE, height * 0.17, height * 0.26, random, wobble)),
    };
  }
  if (entry.mark.correction === '') {
    const pad = height * 0.08;
    return {
      ...base,
      role: 'strike',
      d: keep(hand(x0 - pad, x1 + pad, lift + height * STRIKE, random, wobble)),
    };
  }
  const original = entry.mark.original;
  if (!/\s/u.test(original) && original.length <= SHORT_WORD_LENGTH) {
    const rx = Math.max((x1 - x0) / 2 + height * 0.25, height * 0.5);
    return {
      ...base,
      role: 'ring',
      d: keep(ring((x0 + x1) / 2, lift + height * 0.55, rx, height * 0.56, random, wobble)),
    };
  }
  const pad = height * 0.04;
  return {
    ...base,
    role: 'underline',
    d: keep(hand(x0 - pad, x1 + pad, lift + height * UNDERLINE, random, wobble)),
  };
}

interface CodeSpace {
  readonly codeSize: number;
  readonly bandBaseline: (x: number) => number;
  readonly bandSize: number;
  readonly bandUsable: boolean;
}

const CODE_SEPARATOR = '  ';
const ROW_HEIGHT_EM = 1.05;
const MAX_CODE_ROWS = 2;
const ROW_ROOM = 1.2;

interface CodeRows {
  readonly rows: readonly string[];
  readonly size: number;
}

function fixTokens(entries: readonly Entry[], moved: ReadonlySet<number>): string[] {
  return entries.map((entry) =>
    moved.has(entry.index) ? `${entry.code}: ${entry.mark.correction}` : entry.code,
  );
}

function fitsAt(text: string, size: number, available: number): boolean {
  return estimateTextWidth(text, size) * WIDTH_SAFETY <= available;
}

function wrapCodes(codes: readonly string[], size: number, available: number): string[] | null {
  const rows: string[] = [];
  let row = '';
  for (const code of codes) {
    const candidate = row === '' ? code : `${row}${CODE_SEPARATOR}${code}`;
    if (fitsAt(candidate, size, available)) {
      row = candidate;
    } else {
      if (row === '' || !fitsAt(code, size, available)) return null;
      rows.push(row);
      row = code;
    }
  }
  rows.push(row);
  return rows;
}

function shortenCodes(codes: readonly string[], size: number, available: number): string | null {
  for (let kept = codes.length - 1; kept >= 1; kept -= 1) {
    const text = [...codes.slice(0, kept), `+${codes.length - kept}`].join(CODE_SEPARATOR);
    if (fitsAt(text, size, available)) return text;
  }
  return null;
}

function fitCodeRows(
  entries: readonly Entry[],
  moved: ReadonlySet<number>,
  available: number,
  preferred: number,
  minimum: number,
  maxRows = 1,
): CodeRows {
  const floor = Math.min(minimum, preferred);
  const ladder = sizeLadder(preferred, floor);
  const withFixes = fixTokens(entries, moved).join(CODE_SEPARATOR);
  const codes = entries.map((entry) => entry.code);
  const single = codes.join(CODE_SEPARATOR);
  for (const size of ladder) {
    if (fitsAt(withFixes, size, available)) return { rows: [withFixes], size };
  }
  for (const size of ladder) {
    if (fitsAt(single, size, available)) return { rows: [single], size };
  }
  if (maxRows > 1) {
    for (const size of ladder) {
      const rows = wrapCodes(codes, size, available);
      if (rows !== null && rows.length <= maxRows) return { rows, size };
    }
  }
  const shortened = shortenCodes(codes, floor, available);
  if (shortened !== null) return { rows: [shortened], size: floor };
  const last = codes.length > 1 ? `${codes[0] ?? ''}${CODE_SEPARATOR}+${codes.length - 1}` : single;
  const width = estimateTextWidth(last, 1) * WIDTH_SAFETY;
  return { rows: [last], size: width > 0 ? Math.min(floor, available / width) : floor };
}

function fitEdgeCodes(
  entries: readonly Entry[],
  moved: ReadonlySet<number>,
  frame: Frame,
  codeSize: number,
): { text: string; size: number } {
  const available = frame.column.mode === 'edge' ? frame.column.right - frame.textLeft : 0;
  const fitted = fitCodeRows(
    entries,
    moved,
    available,
    codeSize,
    Math.min(codeSize, MIN_FIX_PIXELS),
  );
  return { text: fitted.rows.join(CODE_SEPARATOR), size: fitted.size };
}

function codesItems(
  line: LocatedLine,
  entries: readonly Entry[],
  moved: ReadonlySet<number>,
  frame: Frame,
  space: CodeSpace,
): TextItem[] {
  const height = line.frame.height;
  const column = frame.column;
  const random = createRandom(seedFor(line.number, 99, 5));
  const common = {
    kind: 'text',
    role: 'code',
    line: line.number,
    mark: null,
    title: entries.map((entry) => entry.title).join(', '),
  } as const;
  const tilt = spread(random, 1.2);
  const rotate = (x: number) => tilt + lineAngleAt(line.frame, x);
  const baseline = (x: number, size: number) =>
    lineTopAt(line.frame, x) + height * CODE_CENTER + size * CODE_DROP;

  if (column.mode === 'margin') {
    const minimum = height * MIN_CODE_FRACTION;
    const rowsRoom = Math.floor((height * ROW_ROOM) / (minimum * ROW_HEIGHT_EM));
    const maxRows = Math.min(MAX_CODE_ROWS, Math.max(1, rowsRoom));
    const ruled = column !== frame.fallback;
    const at = (left: number, right: number): TextItem[] | null => {
      const fitted = fitCodeRows(
        entries,
        moved,
        right - left,
        height * CODE_PREFERRED,
        minimum,
        maxRows,
      );
      if (ruled && fitted.size < minimum * 0.99) return null;
      const step = fitted.size * ROW_HEIGHT_EM;
      const first = baseline(left, fitted.size) - (step * (fitted.rows.length - 1)) / 2;
      return fitted.rows.map((text, row) => ({
        ...common,
        rotate: rotate(left),
        text,
        x: left,
        y: first + row * step,
        size: fitted.size,
        anchor: 'start',
      }));
    };
    if (!ruled) return at(column.left, column.right) ?? [];
    const gap = Math.max(frame.pad, height * RULED_GAP);
    let left = column.left;
    let right = column.right;
    for (let attempt = 0; attempt <= RULED_RETRIES; attempt += 1) {
      const items = at(left, right);
      if (items === null) break;
      const boxes = items.map(textBox);
      const blockers = frame.obstacles.filter((other) => boxes.some((box) => overlaps(box, other)));
      if (blockers.length === 0) return items;
      if (column.side === 'right') left = Math.max(...blockers.map((other) => other.right)) + gap;
      else right = Math.min(...blockers.map((other) => other.left)) - gap;
    }
    return codesItems(line, entries, moved, { ...frame, column: frame.fallback }, space);
  }

  if (!space.bandUsable) {
    const beside = besideText(entries, moved, frame, column.right, space.codeSize);
    if (beside !== null) {
      const x = frame.page.width - frame.inset;
      return [
        {
          ...common,
          rotate: rotate(x),
          text: beside.text,
          x,
          y: baseline(x, beside.size),
          size: beside.size,
          anchor: 'end',
        },
      ];
    }
  }
  const fitted = fitEdgeCodes(
    entries,
    moved,
    frame,
    space.bandUsable ? space.codeSize : Math.max(space.bandSize, MIN_EDGE_CODE_PIXELS),
  );
  return [
    {
      ...common,
      rotate: rotate(column.right),
      text: fitted.text,
      x: column.right,
      y: space.bandBaseline(column.right),
      size: fitted.size,
      anchor: 'end',
    },
  ];
}

function besideText(
  entries: readonly Entry[],
  moved: ReadonlySet<number>,
  frame: Frame,
  textRight: number,
  codeSize: number,
): { text: string; size: number } | null {
  const available = frame.page.width - frame.inset - textRight - codeSize * 0.3;
  const floor = Math.min(codeSize, MIN_FIX_PIXELS);
  for (const text of [
    fixTokens(entries, moved).join(CODE_SEPARATOR),
    entries.map((entry) => entry.code).join(CODE_SEPARATOR),
  ]) {
    for (const size of sizeLadder(codeSize, floor)) {
      if (fitsAt(text, size, available)) return { text, size };
    }
  }
  return null;
}
