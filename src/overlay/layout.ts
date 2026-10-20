import { findErrorKind } from '../annotations/catalog.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';
import type { Mark, Transcript, TranscriptLine } from '../annotations/transcript.ts';
import { estimateTextWidth, FIX_EM_PER_UNIT, textUnits } from './char-width.ts';
import { proportionalLocator, type TextLocator, type XSpan } from './locator.ts';
import type { OverlayItem, OverlayModel, PageSize, StrokeItem, TextItem } from './model.ts';
import { fitRow, sizeLadder } from './pack.ts';
import { createRandom, seedFor, spread } from './random.ts';
import { caret, clampPath, hand, ring } from './strokes.ts';

export interface LayoutOptions {
  readonly page: PageSize;
  readonly profile: CorrectionProfile;
  readonly locator?: TextLocator;
}

type LocatedLine = TranscriptLine & { readonly bbox: NonNullable<TranscriptLine['bbox']> };

type Column =
  | { readonly mode: 'margin'; readonly left: number; readonly right: number }
  | { readonly mode: 'edge'; readonly right: number };

interface Frame {
  readonly page: PageSize;
  readonly pad: number;
  readonly textLeft: number;
  readonly column: Column;
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

function hasBox(line: TranscriptLine): line is LocatedLine {
  return line.bbox !== undefined;
}

export function layoutOverlay(transcript: Transcript, options: LayoutOptions): OverlayModel {
  const { page, profile } = options;
  if (!(page.width > 0) || !(page.height > 0)) {
    throw new RangeError('Die Seitengröße muss größer als 0 sein.');
  }
  const locator = options.locator ?? proportionalLocator;
  const lines = transcript.lines.filter(hasBox);
  const skippedLines = transcript.lines
    .filter((line) => !hasBox(line) && line.marks.length > 0)
    .map((line) => line.number);
  const frame = buildFrame(page, lines);
  const items: OverlayItem[] = [];
  let previousBottom = 0;
  for (const line of lines) {
    if (line.marks.length > 0) {
      items.push(...layoutLine(line, previousBottom, frame, profile, locator));
    }
    previousBottom = line.bbox.y + line.bbox.height;
  }
  return { page, items, skippedLines };
}

function buildFrame(page: PageSize, lines: readonly LocatedLine[]): Frame {
  const pad = Math.max(4, page.width * 0.006);
  if (lines.length === 0) {
    return { page, pad, textLeft: pad, column: { mode: 'edge', right: page.width - pad } };
  }
  const textLeft = Math.min(...lines.map((line) => line.bbox.x));
  const textRight = Math.min(
    Math.max(...lines.map((line) => line.bbox.x + line.bbox.width)),
    page.width - pad,
  );
  const meanHeight = lines.reduce((sum, line) => sum + line.bbox.height, 0) / lines.length;
  const free = page.width - textRight - pad;
  if (free >= Math.max(page.width * 0.04, meanHeight * 1.6)) {
    const left = textRight + Math.min(free * 0.2, meanHeight * 0.8);
    return {
      page,
      pad,
      textLeft: Math.max(textLeft, pad),
      column: { mode: 'margin', left, right: page.width - pad },
    };
  }
  return {
    page,
    pad,
    textLeft: Math.max(textLeft, pad),
    column: { mode: 'edge', right: textRight },
  };
}

function layoutLine(
  line: LocatedLine,
  previousBottom: number,
  frame: Frame,
  profile: CorrectionProfile,
  locator: TextLocator,
): OverlayItem[] {
  const { bbox } = line;
  const height = bbox.height;
  const entries = line.marks.map((mark, index) => toEntry(line, mark, index, profile, locator));
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

  const gap = Math.max(0, bbox.y - previousBottom);
  const bandSize = (gap - height * (FIX_LIFT + 0.02)) / FIX_ASCENT;
  const minFix = Math.max(height * MIN_FIX_FRACTION, MIN_FIX_PIXELS);
  const preferred = Math.min(height * FIX_PREFERRED, bandSize);
  const codeSize = Math.max(Math.min(preferred, height * CODE_PREFERRED), minFix);
  const bandBaseline = bbox.y - height * FIX_LIFT;
  const bandUsable = preferred >= minFix;

  const moved = new Set<number>();
  const rightLimit = (): number => {
    if (frame.column.mode === 'margin') return frame.column.left - frame.pad;
    const codes = fitEdgeCodes(entries, moved, frame, codeSize);
    return frame.column.right - estimateTextWidth(codes.text, codes.size) - codeSize * 1.2;
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
        () => ({ left: frame.pad, right: Math.min(rightLimit(), frame.page.width - frame.pad) }),
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
      items.push({
        kind: 'text',
        role: 'fix',
        text: fix.text,
        x: start,
        y: bandBaseline + spread(random, result.size * 0.05),
        size,
        rotate: spread(random, 1.8),
        anchor: 'start',
        line: line.number,
        mark: fix.entry.index,
        title: `${fix.entry.title}: ${fix.entry.mark.original || '∧'} → ${fix.text}`,
      });
    });
  }

  items.push(
    codesItem(line, entries, moved, frame, { codeSize, bandBaseline, bandSize, bandUsable }),
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
  const { bbox } = line;
  const height = bbox.height;
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
    clampPath(d, width / 2, width / 2, page.width - width / 2, page.height - width / 2);

  if (entry.mark.kind === 'omission') {
    return {
      ...base,
      role: 'caret',
      d: keep(caret(x0, bbox.y + height * BASELINE, height * 0.17, height * 0.26, random, wobble)),
    };
  }
  if (entry.mark.correction === '') {
    const pad = height * 0.08;
    return {
      ...base,
      role: 'strike',
      d: keep(hand(x0 - pad, x1 + pad, bbox.y + height * STRIKE, random, wobble)),
    };
  }
  const original = entry.mark.original;
  if (!/\s/u.test(original) && original.length <= SHORT_WORD_LENGTH) {
    const rx = Math.max((x1 - x0) / 2 + height * 0.25, height * 0.5);
    return {
      ...base,
      role: 'ring',
      d: keep(ring((x0 + x1) / 2, bbox.y + height * 0.55, rx, height * 0.56, random, wobble)),
    };
  }
  const pad = height * 0.04;
  return {
    ...base,
    role: 'underline',
    d: keep(hand(x0 - pad, x1 + pad, bbox.y + height * UNDERLINE, random, wobble)),
  };
}

interface CodeSpace {
  readonly codeSize: number;
  readonly bandBaseline: number;
  readonly bandSize: number;
  readonly bandUsable: boolean;
}

function codeTokens(entries: readonly Entry[], moved: ReadonlySet<number>): string[] {
  return entries.map((entry) =>
    moved.has(entry.index) ? `${entry.code}: ${entry.mark.correction}` : entry.code,
  );
}

function fitEdgeCodes(
  entries: readonly Entry[],
  moved: ReadonlySet<number>,
  frame: Frame,
  codeSize: number,
): { text: string; size: number } {
  const available = frame.column.mode === 'edge' ? frame.column.right - frame.textLeft : 0;
  return fitTokens(
    codeTokens(entries, moved),
    available,
    codeSize,
    Math.min(codeSize, MIN_FIX_PIXELS),
  );
}

function codesItem(
  line: LocatedLine,
  entries: readonly Entry[],
  moved: ReadonlySet<number>,
  frame: Frame,
  space: CodeSpace,
): TextItem {
  const { bbox } = line;
  const column = frame.column;
  const random = createRandom(seedFor(line.number, 99, 5));
  const common = {
    kind: 'text',
    role: 'code',
    rotate: spread(random, 1.2),
    line: line.number,
    mark: null,
    title: entries.map((entry) => entry.title).join(', '),
  } as const;
  const baseline = bbox.y + bbox.height * BASELINE;

  if (column.mode === 'margin') {
    const available = column.right - column.left;
    const size = bbox.height * CODE_PREFERRED;
    const fitted = fitTokens(
      codeTokens(entries, moved),
      available,
      size,
      bbox.height * MIN_CODE_FRACTION,
    );
    return {
      ...common,
      text: fitted.text,
      x: column.left,
      y: baseline,
      size: fitted.size,
      anchor: 'start',
    };
  }

  if (!space.bandUsable) {
    const beside = besideText(entries, moved, frame, column.right, space.codeSize);
    if (beside !== null) {
      return {
        ...common,
        text: beside.text,
        x: frame.page.width - frame.pad,
        y: baseline,
        size: beside.size,
        anchor: 'end',
      };
    }
  }
  const fitted = fitEdgeCodes(
    entries,
    moved,
    frame,
    space.bandUsable ? space.codeSize : Math.max(space.bandSize, MIN_EDGE_CODE_PIXELS),
  );
  return {
    ...common,
    text: fitted.text,
    x: column.right,
    y: space.bandBaseline,
    size: fitted.size,
    anchor: 'end',
  };
}

function besideText(
  entries: readonly Entry[],
  moved: ReadonlySet<number>,
  frame: Frame,
  textRight: number,
  codeSize: number,
): { text: string; size: number } | null {
  const available = frame.page.width - frame.pad - textRight - codeSize * 0.3;
  const floor = Math.min(codeSize, MIN_FIX_PIXELS);
  const tokens = codeTokens(entries, moved);
  const text = tokens.join(' ');
  for (const size of sizeLadder(codeSize, floor)) {
    if (estimateTextWidth(text, size) <= available) return { text, size };
  }
  return null;
}

function fitTokens(
  tokens: readonly string[],
  available: number,
  preferred: number,
  minimum: number,
): { text: string; size: number } {
  const floor = Math.min(minimum, preferred);
  for (const size of sizeLadder(preferred, floor)) {
    const text = tokens.join(' ');
    if (estimateTextWidth(text, size) <= available) return { text, size };
  }
  let kept = [...tokens];
  while (kept.length > 1) {
    kept = kept.slice(0, -1);
    const text = `${kept.join(' ')} …`;
    if (estimateTextWidth(text, floor) <= available) return { text, size: floor };
  }
  return { text: kept.join(' '), size: floor };
}
