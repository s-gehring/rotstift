import type { Mark, Struck, Transcript, TranscriptLine } from './transcript.ts';

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

type Item = { readonly offset: number; readonly length: number; readonly html: string };

function items(marks: readonly Mark[], struck: readonly Struck[]): Item[] {
  return [
    ...marks.map((mark) => ({
      offset: mark.offset,
      length: mark.original.length,
      html: serializeMark(mark),
    })),
    ...struck.map((span) => ({
      offset: span.offset,
      length: span.text.length,
      html: `<rs-struck>${escapeText(span.text)}</rs-struck>`,
    })),
  ].toSorted((a, b) => a.offset - b.offset || a.length - b.length);
}

export function serializeLine(line: TranscriptLine): string {
  let html = '';
  let cursor = 0;
  for (const item of items(line.marks, line.struck ?? [])) {
    html += escapeText(line.text.slice(cursor, item.offset)) + item.html;
    cursor = item.offset + item.length;
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
