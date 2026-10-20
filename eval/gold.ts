import type { Mark, Transcript, TranscriptLine } from '../src/annotations/transcript.ts';
import { parseGold } from '../src/correction/gold.ts';

const TOKEN = /(?:\{[^{}]*\}|[^\s{])+/g;

export const DEFAULT_LINE_CHARS = 60;

export function wrapMarkup(markup: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of markup.split(/\n+/)) {
    let current = '';
    let length = 0;
    for (const token of paragraph.match(TOKEN) ?? []) {
      const size = parseGold(token).written.length;
      if (current !== '' && length + 1 + size > width) {
        lines.push(current);
        current = '';
        length = 0;
      }
      length += current === '' ? size : size + 1;
      current = current === '' ? token : `${current} ${token}`;
    }
    if (current !== '') lines.push(current);
  }
  return lines;
}

export interface GoldText {
  input: Transcript;
  gold: Transcript;
  corrected: string;
}

export function goldFromMarkup(markup: string, width = DEFAULT_LINE_CHARS): GoldText {
  const inputLines: TranscriptLine[] = [];
  const goldLines: TranscriptLine[] = [];
  const corrected: string[] = [];
  wrapMarkup(markup, width).forEach((lineMarkup, index) => {
    const sample = parseGold(lineMarkup);
    const marks: Mark[] = sample.errors.map((error) => ({
      kind: error.written === '' ? 'omission' : 'error',
      type: error.type,
      original: error.written,
      correction: error.correct,
      offset: error.start,
    }));
    inputLines.push({ number: index + 1, text: sample.written, marks: [] });
    goldLines.push({ number: index + 1, text: sample.written, marks });
    corrected.push(sample.corrected);
  });
  return {
    input: { lines: inputLines },
    gold: { lines: goldLines },
    corrected: corrected.join('\n'),
  };
}

export function transcriptFromText(text: string, width = DEFAULT_LINE_CHARS): Transcript {
  return {
    lines: wrapMarkup(text.replaceAll(/[{}|]/g, ' '), width).map((line, index) => ({
      number: index + 1,
      text: line,
      marks: [],
    })),
  };
}

export function plainText(transcript: Transcript): string {
  return transcript.lines.map((line) => line.text).join('\n');
}
