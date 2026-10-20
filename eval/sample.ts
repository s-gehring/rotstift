export type ErrorKind = 'R' | 'Z' | 'G';

export interface MarkedError {
  written: string;
  correct: string;
  kind: ErrorKind;
  start: number;
  end: number;
}

export interface Sample {
  written: string;
  corrected: string;
  errors: MarkedError[];
}

const MARK = /\{([^{}|]*)\|([^{}|]*)\|([RZG])\}/g;

function toKind(value: string | undefined): ErrorKind {
  if (value === 'R' || value === 'Z' || value === 'G') return value;
  throw new Error(`Unknown error kind ${value}`);
}

export function parseSample(markup: string): Sample {
  let written = '';
  let corrected = '';
  const errors: MarkedError[] = [];
  let last = 0;
  for (const match of markup.matchAll(MARK)) {
    const [whole, wrong = '', right = '', kind] = match;
    const plain = markup.slice(last, match.index);
    written += plain;
    corrected += plain;
    errors.push({
      written: wrong,
      correct: right,
      kind: toKind(kind),
      start: written.length,
      end: written.length + wrong.length,
    });
    written += wrong;
    corrected += right;
    last = match.index + whole.length;
  }
  written += markup.slice(last);
  corrected += markup.slice(last);
  if (/[{}]/.test(written)) {
    throw new Error('Malformed error markup, expected {written|correct|R}, Z or G as kind');
  }
  return { written, corrected, errors };
}
