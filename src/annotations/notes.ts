import { z } from 'zod';
import type { CommentKind } from '../content-form/catalog.ts';
import type { ParseIssue } from './parse.ts';

export interface NoteComment {
  readonly line: number;
  readonly kind: CommentKind;
  readonly text: string;
}

export interface PageNotes {
  readonly comments: readonly NoteComment[];
  readonly summary: string | null;
}

export type NotesResult =
  | { readonly ok: true; readonly notes: PageNotes }
  | { readonly ok: false; readonly issues: ParseIssue[] };

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function normalizeSpace(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim();
}

export function serializeNotes(notes: PageNotes): string {
  return [
    ...notes.comments.map(
      (comment) =>
        `<rs-comment n="${comment.line}" kind="${comment.kind}">${escapeText(normalizeSpace(comment.text))}</rs-comment>`,
    ),
    ...(notes.summary === null
      ? []
      : [`<rs-summary>${escapeText(normalizeSpace(notes.summary))}</rs-summary>`]),
  ].join('\n');
}

const commentAttributes = z.strictObject(
  {
    n: z
      .string({ error: 'Pflichtattribut n fehlt.' })
      .regex(/^[1-9]\d*$/u, 'Das Attribut n muss eine positive ganze Zahl sein.')
      .transform(Number),
    kind: z.enum(['content', 'form'], {
      error: 'Das Attribut kind muss „content“ oder „form“ sein.',
    }),
  },
  { error: 'Unbekanntes Attribut.' },
);

function attributesOf(element: Element): Record<string, string> {
  return Object.fromEntries(Array.from(element.attributes, (entry) => [entry.name, entry.value]));
}

function plainText(element: Element, issues: ParseIssue[]): string {
  if (Array.from(element.childNodes).some((child) => child.nodeType !== TEXT_NODE)) {
    issues.push({ message: `<${element.localName}> darf keine Elemente enthalten.` });
  }
  return normalizeSpace(element.textContent);
}

export function parseNotes(html: string): NotesResult {
  const document = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const issues: ParseIssue[] = [];
  const comments: NoteComment[] = [];
  let summary: string | null = null;
  for (const node of Array.from(document.body.childNodes)) {
    if (node.nodeType === TEXT_NODE) {
      if (normalizeSpace(node.textContent ?? '') !== '') {
        issues.push({ message: 'Text außerhalb von <rs-comment> und <rs-summary> ist ungültig.' });
      }
      continue;
    }
    if (node.nodeType !== ELEMENT_NODE || !(node instanceof Element)) continue;
    if (node.localName === 'rs-comment') {
      const attributes = commentAttributes.safeParse(attributesOf(node));
      const text = plainText(node, issues);
      if (!attributes.success) {
        issues.push(...attributes.error.issues.map((issue) => ({ message: issue.message })));
      } else if (text === '') {
        issues.push({ message: '<rs-comment> darf nicht leer sein.', line: attributes.data.n });
      } else {
        comments.push({ line: attributes.data.n, kind: attributes.data.kind, text });
      }
    } else if (node.localName === 'rs-summary') {
      const text = plainText(node, issues);
      if (node.attributes.length > 0) issues.push({ message: '<rs-summary> hat keine Attribute.' });
      if (summary !== null) issues.push({ message: 'Es gibt höchstens ein <rs-summary>.' });
      summary = text === '' ? null : text;
    } else {
      issues.push({ message: `Unerwartetes Element <${node.localName}>.` });
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, notes: { comments, summary } };
}
