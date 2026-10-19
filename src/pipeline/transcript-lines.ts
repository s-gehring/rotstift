const FENCE = /```[^\n]*\n([\s\S]*?)(?:\n```|$)/u;
const THINKING = /<think>[\s\S]*?<\/think>/gu;
const PREAMBLE = [
  /^(hier|dies|das)\s+(ist|sind)\s+(die|der|das|eine?)\s+[^\n]{0,60}?(transkription|transkript|abschrift|text|erkannte)[^\n]{0,40}:?\s*$/iu,
  /^(natürlich|gerne|klar|sicher|selbstverständlich|sure|certainly|of course)\b[^\n]{0,80}:\s*$/iu,
  /^here\s+(is|are)\b[^\n]{0,80}:?\s*$/iu,
  /^(transkription|transkript|abschrift|transcription|transcript)\s*:?\s*$/iu,
];
const POSTSCRIPT = /^\(?\s*(hinweis|anmerkung|bemerkung|note)\b[^\n]*$/iu;

function dropEdgeBlanks(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') start += 1;
  while (end > start && lines[end - 1] === '') end -= 1;
  return lines.slice(start, end);
}

export function splitTranscript(answer: string): string[] {
  let text = answer.replace(/\r\n?/gu, '\n').replace(THINKING, '');
  const fenced = FENCE.exec(text);
  if (fenced?.[1] !== undefined) text = fenced[1];

  let lines = dropEdgeBlanks(text.split('\n').map((line) => line.trimEnd()));
  if (fenced === null) {
    const first = lines[0];
    if (first !== undefined && PREAMBLE.some((pattern) => pattern.test(first.trim()))) {
      lines = dropEdgeBlanks(lines.slice(1));
    }
    const last = lines[lines.length - 1];
    if (last !== undefined && POSTSCRIPT.test(last.trim())) {
      lines = dropEdgeBlanks(lines.slice(0, -1));
    }
  }
  return lines;
}
