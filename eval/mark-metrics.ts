import type { Mark, Transcript, TranscriptLine } from '../src/annotations/transcript.ts';
import { normalize, wordEdits } from './metrics.ts';

export interface TypeTotals {
  gold: number;
  matched: number;
  located: number;
  predicted: number;
}

export interface PageScore {
  gold: number;
  predicted: number;
  strict: number;
  matched: number;
  wrongType: number;
  fixCorrect: number;
  typeTotals: Record<string, TypeTotals>;
  residualBefore: number;
  residualAfter: number;
}

const PUNCTUATION_START = /^[,.;:!?)"“”]/;

function end(mark: Mark): number {
  return mark.offset + mark.original.length;
}

export function applyMarks(text: string, marks: readonly Mark[]): string {
  let result = text;
  for (const mark of marks.toSorted((a, b) => b.offset - a.offset)) {
    const before = result.slice(0, mark.offset);
    const after = result.slice(end(mark));
    if (mark.kind === 'omission' && PUNCTUATION_START.test(mark.correction)) {
      const separator = before.length > before.trimEnd().length && !/^\s/.test(after) ? ' ' : '';
      result = before.trimEnd() + mark.correction + separator + after;
    } else {
      result = before + mark.correction + after;
    }
  }
  return result;
}

function touches(text: string, a: Mark, b: Mark): boolean {
  const pointA = a.kind === 'omission';
  const pointB = b.kind === 'omission';
  if (pointA && pointB) {
    return text.slice(Math.min(a.offset, b.offset), Math.max(a.offset, b.offset)).trim() === '';
  }
  if (pointA) return b.offset < a.offset && a.offset <= end(b);
  if (pointB) return a.offset < b.offset && b.offset <= end(a);
  return a.offset < end(b) && b.offset < end(a);
}

const sameSpan = (a: Mark, b: Mark) =>
  a.kind === b.kind && a.offset === b.offset && a.original === b.original;

interface LineScore {
  strict: number;
  matched: number;
  wrongType: number;
  fixCorrect: number;
  matchedGold: Mark[];
  locatedGold: Mark[];
}

export function scoreLine(
  text: string,
  gold: readonly Mark[],
  predicted: readonly Mark[],
): LineScore {
  const used = new Set<Mark>();
  const paired = new Map<Mark, Mark>();
  const claim = (accept: (candidate: Mark, expected: Mark) => boolean) => {
    for (const expected of gold) {
      if (paired.has(expected)) continue;
      const candidate = predicted.find((entry) => !used.has(entry) && accept(entry, expected));
      if (!candidate) continue;
      used.add(candidate);
      paired.set(expected, candidate);
    }
  };
  claim((candidate, expected) => sameSpan(candidate, expected) && candidate.type === expected.type);
  const strict = paired.size;
  claim(
    (candidate, expected) => candidate.type === expected.type && touches(text, candidate, expected),
  );
  const matched = paired.size;
  let wrongType = 0;
  const locatedGold = [...paired.keys()];
  for (const expected of gold) {
    if (paired.has(expected)) continue;
    const candidate = predicted.find((entry) => !used.has(entry) && touches(text, entry, expected));
    if (candidate) {
      used.add(candidate);
      locatedGold.push(expected);
      wrongType += 1;
    }
  }
  let fixCorrect = 0;
  for (const [expected, candidate] of paired) {
    if (applyMarks(text, [candidate]) === applyMarks(text, [expected])) fixCorrect += 1;
  }
  return { strict, matched, wrongType, fixCorrect, matchedGold: [...paired.keys()], locatedGold };
}

function typeEntry(totals: Record<string, TypeTotals>, type: string): TypeTotals {
  return (totals[type] ??= { gold: 0, matched: 0, located: 0, predicted: 0 });
}

function byNumber(transcript: Transcript | undefined): Map<number, TranscriptLine> {
  return new Map((transcript?.lines ?? []).map((line) => [line.number, line]));
}

export function scorePage(input: Transcript, gold: Transcript, predicted?: Transcript): PageScore {
  const goldLines = byNumber(gold);
  const predictedLines = byNumber(predicted);
  const score: PageScore = {
    gold: 0,
    predicted: 0,
    strict: 0,
    matched: 0,
    wrongType: 0,
    fixCorrect: 0,
    typeTotals: {},
    residualBefore: 0,
    residualAfter: 0,
  };
  let corrected = '';
  let before = '';
  let after = '';
  for (const line of input.lines) {
    const expected = goldLines.get(line.number)?.marks ?? [];
    const actual = predictedLines.get(line.number)?.marks ?? [];
    const result = scoreLine(line.text, expected, actual);
    score.gold += expected.length;
    score.predicted += actual.length;
    score.strict += result.strict;
    score.matched += result.matched;
    score.wrongType += result.wrongType;
    score.fixCorrect += result.fixCorrect;
    for (const mark of expected) {
      const totals = typeEntry(score.typeTotals, mark.type);
      totals.gold += 1;
      if (result.matchedGold.includes(mark)) totals.matched += 1;
      if (result.locatedGold.includes(mark)) totals.located += 1;
    }
    for (const mark of actual) typeEntry(score.typeTotals, mark.type).predicted += 1;
    corrected += `${applyMarks(line.text, expected)}\n`;
    before += `${line.text}\n`;
    after += `${applyMarks(line.text, actual)}\n`;
  }
  score.residualBefore = wordEdits(corrected, before).edits;
  score.residualAfter = wordEdits(corrected, after).edits;
  return score;
}

export function sumScores(scores: readonly PageScore[]): PageScore {
  const total: PageScore = {
    gold: 0,
    predicted: 0,
    strict: 0,
    matched: 0,
    wrongType: 0,
    fixCorrect: 0,
    typeTotals: {},
    residualBefore: 0,
    residualAfter: 0,
  };
  for (const score of scores) {
    total.gold += score.gold;
    total.predicted += score.predicted;
    total.strict += score.strict;
    total.matched += score.matched;
    total.wrongType += score.wrongType;
    total.fixCorrect += score.fixCorrect;
    total.residualBefore += score.residualBefore;
    total.residualAfter += score.residualAfter;
    for (const [type, counts] of Object.entries(score.typeTotals)) {
      const entry = typeEntry(total.typeTotals, type);
      entry.gold += counts.gold;
      entry.matched += counts.matched;
      entry.located += counts.located;
      entry.predicted += counts.predicted;
    }
  }
  return total;
}

const HTML_ENTITIES: [RegExp, string][] = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&amp;/g, '&'],
];

export function rawLineTexts(output: string): Map<number, string> {
  const lines = new Map<number, string>();
  for (const match of output.matchAll(/<rs-line\b([^>]*)>([\s\S]*?)<\/rs-line>/gi)) {
    const number = /\bn\s*=\s*["']?(\d+)/i.exec(match[1] ?? '')?.[1];
    if (number === undefined) continue;
    let text = (match[2] ?? '').replaceAll(/<rs-missing\b[^>]*>(?:<\/rs-missing>)?/gi, '');
    text = text.replaceAll(/<\/?rs-error\b[^>]*>/gi, '');
    for (const [pattern, replacement] of HTML_ENTITIES) text = text.replace(pattern, replacement);
    lines.set(Number(number), normalize(text));
  }
  return lines;
}

export function preservedLines(input: Transcript, output: string): number {
  const texts = rawLineTexts(output);
  return input.lines.filter((line) => texts.get(line.number) === normalize(line.text)).length;
}

export interface RemappedGold {
  gold: Transcript;
  recoverable: number;
  total: number;
}

function tokens(transcript: Transcript) {
  return transcript.lines.flatMap((line) =>
    [...line.text.matchAll(/\S+/g)].map((match) => ({
      line: line.number,
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })),
  );
}

export function remapGold(source: Transcript, ocr: Transcript): RemappedGold {
  const goldTokens = tokens(source);
  const ocrTokens = tokens(ocr);
  const links = linkWords(
    goldTokens.map((token) => normalize(token.text)),
    ocrTokens.map((token) => normalize(token.text)),
  );
  const lines = ocr.lines.map((line) => ({ ...line, marks: [] as Mark[] }));
  let total = 0;
  let recoverable = 0;
  for (const line of source.lines) {
    for (const mark of line.marks) {
      total += 1;
      const first = mark.kind === 'omission' ? mark.offset - 1 : mark.offset;
      const last = mark.kind === 'omission' ? mark.offset - 1 : end(mark) - 1;
      const covered = goldTokens
        .map((token, index) => ({ token, index }))
        .filter(
          ({ token }) => token.line === line.number && token.start <= last && token.end > first,
        );
      const head = covered[0];
      const tail = covered.at(-1);
      if (!head || !tail) continue;
      const mapped = covered.map(({ index }) => links[index]);
      if (mapped.some((index) => index === undefined)) continue;
      const ocrHead = ocrTokens[mapped[0] ?? -1];
      const ocrTail = ocrTokens[mapped.at(-1) ?? -1];
      if (!ocrHead || !ocrTail || ocrHead.line !== ocrTail.line) continue;
      const delta = mark.kind === 'omission' ? 0 : mark.offset - head.token.start;
      const offset = mark.kind === 'omission' ? ocrTail.end : ocrHead.start + delta;
      const target = lines.find((entry) => entry.number === ocrHead.line);
      if (!target) continue;
      target.marks.push({ ...mark, offset });
      recoverable += 1;
    }
  }
  for (const line of lines) line.marks.sort((a, b) => a.offset - b.offset);
  return { gold: { lines }, recoverable, total };
}

export function linkWords(
  reference: readonly string[],
  hypothesis: readonly string[],
): (number | undefined)[] {
  const rows = reference.length + 1;
  const columns = hypothesis.length + 1;
  const cost = new Uint32Array(rows * columns);
  for (let j = 0; j < columns; j++) cost[j] = j;
  for (let i = 1; i < rows; i++) {
    cost[i * columns] = i;
    for (let j = 1; j < columns; j++) {
      const same = reference[i - 1] === hypothesis[j - 1] ? 0 : 1;
      cost[i * columns + j] = Math.min(
        (cost[(i - 1) * columns + j - 1] ?? 0) + same,
        (cost[(i - 1) * columns + j] ?? 0) + 1,
        (cost[i * columns + j - 1] ?? 0) + 1,
      );
    }
  }
  const links: (number | undefined)[] = reference.map(() => undefined);
  let i = reference.length;
  let j = hypothesis.length;
  while (i > 0 && j > 0) {
    const here = cost[i * columns + j] ?? 0;
    const same = reference[i - 1] === hypothesis[j - 1];
    if (same && here === (cost[(i - 1) * columns + j - 1] ?? 0)) {
      links[i - 1] = j - 1;
      i--;
      j--;
    } else if (here === (cost[(i - 1) * columns + j - 1] ?? 0) + 1) {
      i--;
      j--;
    } else if (here === (cost[(i - 1) * columns + j] ?? 0) + 1) {
      i--;
    } else {
      j--;
    }
  }
  return links;
}
