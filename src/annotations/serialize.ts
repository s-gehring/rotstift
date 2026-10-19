import type { Mark, Transcript, TranscriptLine } from './transcript.ts';

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;');
}

function serializeMark(mark: Mark): string {
  const attributes = `type="${escapeAttribute(mark.type)}" fix="${escapeAttribute(mark.correction)}"`;
  return mark.kind === 'omission'
    ? `<rs-missing ${attributes}></rs-missing>`
    : `<rs-error ${attributes}>${escapeText(mark.original)}</rs-error>`;
}

export function serializeLine(line: TranscriptLine): string {
  let html = '';
  let cursor = 0;
  for (const mark of line.marks) {
    html += escapeText(line.text.slice(cursor, mark.offset)) + serializeMark(mark);
    cursor = mark.offset + mark.original.length;
  }
  html += escapeText(line.text.slice(cursor));

  const bbox = line.bbox
    ? ` bbox="${line.bbox.x},${line.bbox.y},${line.bbox.width},${line.bbox.height}"`
    : '';
  return `<rs-line n="${line.number}"${bbox}>${html}</rs-line>`;
}

export function serializeTranscript(transcript: Transcript): string {
  return transcript.lines.map(serializeLine).join('\n');
}
