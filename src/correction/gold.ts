export interface GoldError {
  written: string;
  correct: string;
  type: string;
  start: number;
  end: number;
}

export interface GoldText {
  written: string;
  corrected: string;
  errors: GoldError[];
}

const MARKUP = /\{([^{}|]*)\|([^{}|]*)\|([A-Za-z]+)\}/g;

export function parseGold(markup: string): GoldText {
  let written = '';
  let corrected = '';
  let last = 0;
  const errors: GoldError[] = [];
  for (const match of markup.matchAll(MARKUP)) {
    const [whole, wrong = '', right = '', type = ''] = match;
    const plain = markup.slice(last, match.index);
    written += plain;
    corrected += plain;
    errors.push({
      written: wrong,
      correct: right,
      type,
      start: written.length,
      end: written.length + wrong.length,
    });
    written += wrong;
    corrected += right;
    last = match.index + whole.length;
  }
  const rest = markup.slice(last);
  return { written: written + rest, corrected: corrected + rest, errors };
}

export interface WrappedText {
  lines: string[];
  starts: number[];
}

export function wrapText(text: string, width: number): WrappedText {
  const lines: string[] = [];
  const starts: number[] = [];
  let base = 0;
  for (const paragraph of text.split('\n')) {
    let current = '';
    let currentStart = base;
    let position = base;
    for (const word of paragraph.split(' ')) {
      if (current !== '' && current.length + 1 + word.length > width) {
        lines.push(current);
        starts.push(currentStart);
        current = word;
        currentStart = position;
      } else {
        current = current === '' ? word : `${current} ${word}`;
      }
      position += word.length + 1;
    }
    lines.push(current);
    starts.push(currentStart);
    base += paragraph.length + 1;
  }
  return { lines, starts };
}

export interface FoundMark {
  type: string;
  start: number;
  end: number;
}

function overlaps(mark: FoundMark, error: GoldError): boolean {
  if (error.start === error.end) {
    return mark.start === mark.end
      ? mark.start === error.start
      : mark.start < error.start && error.start < mark.end;
  }
  if (mark.start === mark.end) return error.start < mark.start && mark.start < error.end;
  return mark.start < error.end && error.start < mark.end;
}

export interface TypeScore {
  type: string;
  found: number;
  truePositives: number;
  gold: number;
  detected: number;
  precision: number;
  recall: number;
}

function ratio(part: number, whole: number): number {
  return whole === 0 ? 1 : part / whole;
}

export function scoreMarks(errors: readonly GoldError[], marks: readonly FoundMark[]): TypeScore[] {
  const types = [...new Set([...errors.map((e) => e.type), ...marks.map((m) => m.type)])];
  return types.map((type) => {
    const found = marks.filter((mark) => mark.type === type);
    const gold = errors.filter((error) => error.type === type);
    const truePositives = found.filter((mark) =>
      gold.some((error) => overlaps(mark, error)),
    ).length;
    const detected = gold.filter((error) => found.some((mark) => overlaps(mark, error))).length;
    return {
      type,
      found: found.length,
      truePositives,
      gold: gold.length,
      detected,
      precision: ratio(truePositives, found.length),
      recall: ratio(detected, gold.length),
    };
  });
}
