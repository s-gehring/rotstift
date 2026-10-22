export interface StruckSpan {
  readonly offset: number;
  readonly text: string;
}

export interface StruckLine {
  readonly text: string;
  readonly struck: StruckSpan[];
}

export interface VisibleLine {
  readonly text: string;
  readonly positions: readonly number[];
}

const MARKED = /~~([^\s~](?:[^~\n]*[^\s~])?)~~/gu;
const WORD = /\S+/gu;
const STROKE = '\u0336';
const STROKED = /(?:[^\u0336\n]\u0336)+/gu;
const PADDED = /^(\s*)(.*?)(\s*)$/su;

export function strokeStruck(text: string): string {
  return text.replace(MARKED, (_match, inner: string) => inner.replace(/./gu, `$&${STROKE}`));
}

export function unstrokeStruck(text: string): string {
  return text.replace(STROKED, (run) => {
    const plain = run.replaceAll(STROKE, '');
    const [, before = '', inner = '', after = ''] = PADDED.exec(plain) ?? [];
    return inner === '' ? plain : `${before}~~${inner}~~${after}`;
  });
}

const CARET = '\uE000';

export function restrokedCaret(value: string, caret: number): number {
  const marked = `${value.slice(0, caret)}${CARET}${value.slice(caret)}`;
  return strokeStruck(unstrokeStruck(marked)).indexOf(CARET);
}

export function splitStruck(text: string): { readonly text: string; readonly struck: boolean }[] {
  const parts: { text: string; struck: boolean }[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MARKED)) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), struck: false });
    parts.push({ text: match[1] ?? '', struck: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), struck: false });
  return parts;
}

export function readStruck(line: string): StruckLine {
  let text = '';
  const struck: StruckSpan[] = [];
  let cursor = 0;
  for (const match of line.matchAll(MARKED)) {
    text += line.slice(cursor, match.index);
    const inner = match[1] ?? '';
    struck.push({ offset: text.length, text: inner });
    text += inner;
    cursor = match.index + match[0].length;
  }
  return { text: text + line.slice(cursor), struck };
}

export function markStruck(line: string, words: readonly number[]): string {
  if (words.length === 0) return line;
  const wanted = new Set(words);
  let index = -1;
  return line.replace(WORD, (word) => {
    index += 1;
    if (!wanted.has(index) || (word.startsWith('~~') && word.endsWith('~~'))) return word;
    return `~~${word}~~`;
  });
}

export function visibleLine(text: string, struck: readonly StruckSpan[]): VisibleLine {
  let visible = '';
  const positions: number[] = [];
  let span = 0;
  for (let index = 0; index < text.length; index += 1) {
    while (
      span < struck.length &&
      index >= (struck[span]?.offset ?? 0) + (struck[span]?.text.length ?? 0)
    ) {
      span += 1;
    }
    if (index >= (struck[span]?.offset ?? Infinity)) continue;
    const char = text[index] ?? '';
    if (char === ' ' && (visible === '' || visible.endsWith(' '))) continue;
    visible += char;
    positions.push(index);
  }
  if (visible.endsWith(' ')) {
    visible = visible.slice(0, -1);
    positions.pop();
  }
  return { text: visible, positions };
}

export function visibleText(line: { text: string; struck?: readonly StruckSpan[] }): string {
  return line.struck === undefined || line.struck.length === 0
    ? line.text
    : visibleLine(line.text, line.struck).text;
}
