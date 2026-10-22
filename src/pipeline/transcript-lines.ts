const FENCE = /```[^\n]*\n([\s\S]*?)(?:\n```|$)/u;
const THINKING_CLOSED = /<think>[\s\S]*?<\/think>/gu;
const THINKING_UNCLOSED = /<think>[\s\S]*$/u;
const THINKING_STRAY_END = /^[\s\S]*<\/think>/u;

const TRANSCRIPT_NOUN =
  '(?:transkription|transkript|abschrift|(?:erkannte[rn]?|transkribierte[rn]?|handgeschriebene[rn]?|handschriftliche[rn]?)\\s+text|text\\s+(?:aus|von)\\s+(?:dem|der)\\s+(?:bild|seite|handschrift))';
const PREAMBLE = [
  new RegExp(
    `^(?:hier|dies|das)\\s+(?:ist|sind)\\s+(?:die|der|das|eine?)\\s+[^\\n]{0,60}?${TRANSCRIPT_NOUN}[^\\n]{0,40}:$`,
    'iu',
  ),
  /^(?:natürlich|gerne|klar|sicher|selbstverständlich|sure|certainly|of course)\b[^\n]{0,80}(?:transkri|abschrift|text|transcri|erkannt)[^\n]{0,40}:$/iu,
  /^here\s+(?:is|are)\b[^\n]{0,80}(?:transcri|text|handwrit)[^\n]{0,40}:$/iu,
  /^(?:transkription|transkript|abschrift|transcription|transcript)\s*:$/iu,
];

const POSTSCRIPT_VOCABULARY =
  /unleserlich|schwer\s+lesbar|nicht\s+lesbar|schlecht\s+lesbar|lesbarkeit|transkription|transkribiert|illegible/iu;
const POSTSCRIPT_BRACKETED = /^[([].*[)\]]$/u;
const POSTSCRIPT_LABELLED = /^(?:hinweis|anmerkung|bemerkung|note)\s*:/iu;
const POSTSCRIPT_MIN_WORDS = 3;

const LOOP_MAX_PERIOD = 16;
const LOOP_MIN_REPEATS = 20;
const LOOP_MIN_WORDS = 80;

function dropEdgeBlanks(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') start += 1;
  while (end > start && lines[end - 1] === '') end -= 1;
  return lines.slice(start, end);
}

export interface ParsedTranscript {
  readonly lines: string[];
  readonly removedThinking: boolean;
}

function stripThinking(text: string): string {
  return text
    .replace(THINKING_CLOSED, '')
    .replace(THINKING_UNCLOSED, '')
    .replace(THINKING_STRAY_END, '');
}

function unmark(line: string): string {
  return line
    .trim()
    .replace(/^[#>\s*_]+/u, '')
    .replace(/[*_]+$/u, '')
    .trim();
}

function isPreamble(line: string): boolean {
  const plain = unmark(line);
  return PREAMBLE.some((pattern) => pattern.test(plain));
}

function isPostscript(line: string): boolean {
  const plain = line.trim();
  if (plain.split(/\s+/u).length < POSTSCRIPT_MIN_WORDS) return false;
  if (!POSTSCRIPT_VOCABULARY.test(plain)) return false;
  return POSTSCRIPT_BRACKETED.test(plain) || POSTSCRIPT_LABELLED.test(plain);
}

export function parseTranscript(answer: string): ParsedTranscript {
  const normalized = answer.replace(/\r\n?/gu, '\n');
  const withoutThinking = stripThinking(normalized);
  let text = withoutThinking;
  const fenced = FENCE.exec(text);
  if (fenced?.[1] !== undefined) text = fenced[1];

  let lines = dropEdgeBlanks(text.split('\n').map((line) => line.trimEnd()));
  if (fenced === null) {
    const first = lines[0];
    if (first !== undefined && isPreamble(first)) {
      lines = dropEdgeBlanks(lines.slice(1));
    }
    const last = lines[lines.length - 1];
    if (last !== undefined && isPostscript(last)) {
      lines = dropEdgeBlanks(lines.slice(0, -1));
    }
  }
  return { lines, removedThinking: withoutThinking !== normalized };
}

export function splitTranscript(answer: string): string[] {
  return parseTranscript(answer).lines;
}

function normalizedWords(lines: readonly string[]): string[] {
  return lines
    .join(' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');
}

export function hasRepetitionLoop(lines: readonly string[]): boolean {
  const words = normalizedWords(lines);
  for (let period = 1; period <= LOOP_MAX_PERIOD; period += 1) {
    let run = 0;
    for (let index = period; index < words.length; index += 1) {
      run = words[index] === words[index - period] ? run + 1 : 0;
      const repeats = Math.floor(run / period) + 1;
      if (repeats >= LOOP_MIN_REPEATS && repeats * period >= LOOP_MIN_WORDS) return true;
    }
  }
  return false;
}

export function isDegenerateAnswer(finishReason: string | null, lines: readonly string[]): boolean {
  return finishReason === 'length' || hasRepetitionLoop(lines);
}
