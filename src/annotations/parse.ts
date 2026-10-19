import { z } from 'zod';
import { findErrorKind } from './catalog.ts';
import { clip } from './clip.ts';
import type { CorrectionProfile } from './profile.ts';
import { bboxSchema, transcriptSchema } from './transcript.ts';
import type { Mark, Transcript, TranscriptLine } from './transcript.ts';

export interface ParseIssue {
  message: string;
  line?: number;
}

export type ParseResult =
  { ok: true; transcript: Transcript } | { ok: false; issues: ParseIssue[] };

export interface ParseOptions {
  profile: CorrectionProfile;
  source?: Transcript;
}

export const MAX_ISSUES = 20;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function isElement(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE;
}

function normalizeSpace(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

const BBOX_PATTERN = /^\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?){3}\s*$/;

const lineAttributes = z.object({
  n: z
    .string({ error: 'Pflichtattribut n fehlt.' })
    .regex(/^[1-9]\d*$/, 'Das Attribut n muss eine positive ganze Zahl sein.')
    .transform(Number),
  bbox: z
    .string()
    .regex(
      BBOX_PATTERN,
      'Das Attribut bbox muss vier Zahlen im Format „x,y,breite,höhe“ enthalten.',
    )
    .transform((value) => {
      const [x, y, width, height] = value.split(',').map(Number);
      return { x, y, width, height };
    })
    .pipe(bboxSchema)
    .optional(),
});

const markAttributes = z.object({
  type: z
    .string({ error: 'Pflichtattribut type fehlt.' })
    .trim()
    .min(1, 'Das Attribut type darf nicht leer sein.'),
  fix: z
    .string({ error: 'Pflichtattribut fix fehlt (eine leere Korrektur ist fix="").' })
    .transform(normalizeSpace),
});

interface LineState {
  position: number;
  number: number | undefined;
  text: string;
  marks: Mark[];
}

class Collector {
  readonly issues: ParseIssue[] = [];

  constructor(private readonly profile: CorrectionProfile) {}

  report(line: LineState | undefined, message: string): void {
    if (!line) {
      this.issues.push({ message });
    } else if (line.number === undefined) {
      this.issues.push({ message: `${message} (${line.position}. <rs-line> der Ausgabe)` });
    } else {
      this.issues.push({ message, line: line.number });
    }
  }

  resolveType(line: LineState, tag: string, raw: string): string | undefined {
    const profile = this.profile;
    const kind = findErrorKind(profile.language, raw);
    const allowed = profile.allowedTypes.join(', ');
    if (!kind) {
      this.report(
        line,
        `<${tag}>: Unbekannter Fehlertyp „${clip(raw)}“. Erlaubt sind: ${allowed}.`,
      );
      return undefined;
    }
    if (!profile.allowedTypes.includes(kind.code)) {
      this.report(
        line,
        `<${tag}>: Der Fehlertyp „${kind.code}“ ist im Profil „${profile.name}“ nicht erlaubt. Erlaubt sind: ${allowed}.`,
      );
      return undefined;
    }
    return kind.code;
  }

  attributes<T extends z.ZodType>(
    line: LineState,
    tag: string,
    schema: T,
    element: Element,
    names: string[],
  ): z.output<T> | undefined {
    for (const { name } of Array.from(element.attributes)) {
      if (!names.includes(name)) {
        this.report(
          line,
          `<${tag}>: Unbekanntes Attribut „${clip(name)}“. Erlaubt sind: ${names.join(', ')}.`,
        );
      }
    }
    const input = Object.fromEntries(
      names.map((name) => [name, element.getAttribute(name) ?? undefined]),
    );
    const result = schema.safeParse(input);
    if (result.success) {
      return result.data;
    }
    for (const issue of result.error.issues) {
      this.report(line, `<${tag}>: ${issue.message}`);
    }
    return undefined;
  }
}

function appendText(line: LineState, text: string): void {
  const collapsed = text.replaceAll(/\s+/g, ' ');
  line.text += line.text === '' || line.text.endsWith(' ') ? collapsed.trimStart() : collapsed;
}

function collectMarkText(collector: Collector, line: LineState, tag: string, node: Node): string {
  let text = '';
  for (const child of node.childNodes) {
    if (child.nodeType === TEXT_NODE) {
      text += child.textContent ?? '';
    } else if (isElement(child)) {
      const name = child.localName;
      if (name === 'rs-error' || name === 'rs-missing') {
        collector.report(
          line,
          `<${name}> darf nicht in <${tag}> verschachtelt sein. Markierungen dürfen sich nicht überlappen oder enthalten.`,
        );
      } else {
        collector.report(line, `Unbekanntes Element <${clip(name)}> in <${tag}>.`);
      }
      text += collectMarkText(collector, line, tag, child);
    }
  }
  return text;
}

function parseError(collector: Collector, line: LineState, element: Element): void {
  const attributes = collector.attributes(line, 'rs-error', markAttributes, element, [
    'type',
    'fix',
  ]);
  const raw = collectMarkText(collector, line, 'rs-error', element).replaceAll(/\s+/g, ' ');
  const original = raw.trim();
  const type = attributes && collector.resolveType(line, 'rs-error', attributes.type);

  if (original === '') {
    collector.report(
      line,
      'Ein <rs-error> ohne Text ist leer. Für ein fehlendes Zeichen oder Wort wird <rs-missing> verwendet.',
    );
  } else if (attributes && attributes.fix === original) {
    collector.report(
      line,
      `<rs-error>: Die Korrektur „${clip(attributes.fix)}“ ist identisch mit dem Originaltext.`,
    );
  }

  const valid = type !== undefined && attributes !== undefined;
  if (raw.startsWith(' ')) {
    appendText(line, ' ');
  }
  if (valid && original !== '' && attributes.fix !== original) {
    line.marks.push({
      kind: 'error',
      type,
      original,
      correction: attributes.fix,
      offset: line.text.length,
    });
  }
  line.text += original;
  if (raw.endsWith(' ') && original !== '') {
    appendText(line, ' ');
  }
}

function parseOmission(collector: Collector, line: LineState, element: Element): void {
  const attributes = collector.attributes(line, 'rs-missing', markAttributes, element, [
    'type',
    'fix',
  ]);
  const type = attributes && collector.resolveType(line, 'rs-missing', attributes.type);

  if (attributes && attributes.fix === '') {
    collector.report(line, '<rs-missing>: Das Attribut fix muss den fehlenden Text enthalten.');
  }
  if (attributes && type !== undefined && attributes.fix !== '') {
    line.marks.push({
      kind: 'omission',
      type,
      original: '',
      correction: attributes.fix,
      offset: line.text.length,
    });
  }

  if (element.childNodes.length > 0) {
    collector.report(
      line,
      '<rs-missing> darf keinen Inhalt haben. In HTML gibt es kein selbstschließendes Tag, geschrieben wird <rs-missing type="…" fix="…"></rs-missing>.',
    );
    walkLine(collector, line, element);
  }
}

function walkLine(collector: Collector, line: LineState, parent: Node): void {
  for (const node of parent.childNodes) {
    if (node.nodeType === TEXT_NODE) {
      appendText(line, node.textContent ?? '');
    } else if (isElement(node)) {
      const element = node;
      switch (element.localName) {
        case 'rs-error':
          parseError(collector, line, element);
          break;
        case 'rs-missing':
          parseOmission(collector, line, element);
          break;
        case 'rs-line':
          collector.report(line, '<rs-line> darf nicht in einer anderen <rs-line> stehen.');
          walkLine(collector, line, element);
          break;
        default:
          collector.report(line, `Unbekanntes Element <${clip(element.localName)}> in der Zeile.`);
          walkLine(collector, line, element);
      }
    }
  }
}

function parseLine(
  collector: Collector,
  element: Element,
  position: number,
): TranscriptLine | undefined {
  const line: LineState = { position, number: undefined, text: '', marks: [] };
  const rawNumber = element.getAttribute('n') ?? '';
  line.number = /^[1-9]\d*$/.test(rawNumber) ? Number(rawNumber) : undefined;
  const attributes = collector.attributes(line, 'rs-line', lineAttributes, element, ['n', 'bbox']);

  walkLine(collector, line, element);

  if (line.text.endsWith(' ')) {
    line.text = line.text.slice(0, -1);
    for (const mark of line.marks) {
      mark.offset = Math.min(mark.offset, line.text.length);
    }
  }
  if (!attributes) {
    return undefined;
  }
  return {
    number: attributes.n,
    ...(attributes.bbox ? { bbox: attributes.bbox } : {}),
    text: line.text,
    marks: line.marks,
  };
}

const TAG_PATTERN = /<(\/?)(rs-line|rs-error|rs-missing)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;

function checkTagBalance(html: string): ParseIssue[] {
  const issues: ParseIssue[] = [];
  let lineDepth = 0;
  let lineNumber: number | undefined;
  let errorDepth = 0;

  const report = (message: string): void => {
    issues.push(lineNumber === undefined ? { message } : { message, line: lineNumber });
  };
  const unclosed = (before: string): void => {
    report(
      `<rs-error> wurde nicht geschlossen, bevor ${before} kommt. Jede Markierung muss in derselben Zeile mit </rs-error> enden.`,
    );
    errorDepth = 0;
  };

  for (const match of html.matchAll(TAG_PATTERN)) {
    const closing = match[1] === '/';
    const tag = (match[2] ?? '').toLowerCase();
    if (tag === 'rs-line' && !closing) {
      if (errorDepth > 0) {
        unclosed('die nächste <rs-line>');
      }
      lineDepth += 1;
      const number = /\bn\s*=\s*["']?(\d+)/i.exec(match[3] ?? '')?.[1];
      lineNumber = number === undefined ? undefined : Number(number);
    } else if (tag === 'rs-line') {
      if (errorDepth > 0) {
        unclosed('</rs-line>');
      }
      if (lineDepth === 0) {
        report('</rs-line> ohne öffnendes <rs-line>.');
      } else {
        lineDepth -= 1;
      }
    } else if (tag === 'rs-error' && !closing) {
      errorDepth += 1;
    } else if (tag === 'rs-error') {
      if (errorDepth === 0) {
        report('</rs-error> ohne öffnendes <rs-error> in dieser Zeile.');
      } else {
        errorDepth -= 1;
      }
    }
  }

  if (errorDepth > 0) {
    unclosed('die Ausgabe endet');
  }
  if (lineDepth > 0) {
    report('<rs-line> wurde nicht mit </rs-line> geschlossen.');
  }
  return issues;
}

function excerpt(text: string, index: number): string {
  const start = Math.max(0, index - 20);
  return `${start > 0 ? '…' : ''}${clip(text.slice(start), 60)}`;
}

function firstDifference(a: string, b: string): number {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) {
    index += 1;
  }
  return index;
}

function applySource(collector: Collector, lines: TranscriptLine[], source: Transcript): void {
  const parsed = new Map(lines.map((line) => [line.number, line]));
  const expected = new Set(source.lines.map((line) => line.number));

  for (const sourceLine of source.lines) {
    const line = parsed.get(sourceLine.number);
    if (!line) {
      collector.issues.push({
        message: 'Die Zeile fehlt in der Ausgabe. Alle Zeilen der Eingabe müssen wiederkehren.',
        line: sourceLine.number,
      });
      continue;
    }
    const sourceText = normalizeSpace(sourceLine.text);
    if (line.text !== sourceText) {
      const at = firstDifference(line.text, sourceText);
      collector.issues.push({
        message: `Der Text der Zeile wurde verändert. Erwartet: „${excerpt(sourceText, at)}“, gefunden: „${excerpt(line.text, at)}“. Der Text darf nur markiert, nicht geändert werden.`,
        line: line.number,
      });
    }
    if (sourceLine.bbox) {
      line.bbox = sourceLine.bbox;
    } else {
      delete line.bbox;
    }
  }
  for (const line of lines) {
    if (!expected.has(line.number)) {
      collector.issues.push({
        message: 'Diese Zeile gibt es in der Eingabe nicht. Es dürfen keine Zeilen hinzukommen.',
        line: line.number,
      });
    }
  }
}

function stripCodeFence(html: string): string {
  const match = /^\s*```[a-z]*[ \t]*\r?\n([\s\S]*?)\r?\n?```\s*$/i.exec(html);
  return match?.[1] ?? html;
}

function capIssues(issues: ParseIssue[]): ParseIssue[] {
  if (issues.length <= MAX_ISSUES) {
    return issues;
  }
  return [
    ...issues.slice(0, MAX_ISSUES),
    { message: `… und ${issues.length - MAX_ISSUES} weitere Meldungen.` },
  ];
}

export function parseTranscript(html: string, options: ParseOptions): ParseResult {
  const collector = new Collector(options.profile);
  const body = stripCodeFence(html);
  collector.issues.push(...checkTagBalance(body));
  const document = new DOMParser().parseFromString(body, 'text/html');
  const lines: TranscriptLine[] = [];
  let position = 0;

  for (const node of document.body.childNodes) {
    if (node.nodeType === TEXT_NODE) {
      const text = (node.textContent ?? '').trim();
      if (text !== '') {
        collector.report(
          undefined,
          `Text außerhalb einer Zeile: „${clip(text)}“. Der gesamte Text muss in <rs-line>-Elementen stehen.`,
        );
      }
    } else if (isElement(node)) {
      const element = node;
      if (element.localName === 'rs-line') {
        position += 1;
        const line = parseLine(collector, element, position);
        if (line) {
          lines.push(line);
        }
      } else {
        collector.report(
          undefined,
          `<${clip(element.localName)}> steht außerhalb einer <rs-line>. Auf oberster Ebene sind nur <rs-line>-Elemente erlaubt.`,
        );
      }
    }
  }

  if (position === 0 && collector.issues.length === 0) {
    collector.report(undefined, 'Die Ausgabe enthält keine <rs-line>-Zeile.');
  }
  if (options.source) {
    applySource(collector, lines, options.source);
  }

  const checked = transcriptSchema.safeParse({ lines });
  if (checked.success) {
    return collector.issues.length === 0
      ? { ok: true, transcript: checked.data }
      : { ok: false, issues: capIssues(collector.issues) };
  }
  for (const issue of checked.error.issues) {
    const index = issue.path[1];
    const number = typeof index === 'number' ? lines[index]?.number : undefined;
    collector.issues.push({
      message: issue.message,
      ...(number === undefined ? {} : { line: number }),
    });
  }
  return { ok: false, issues: capIssues(collector.issues) };
}

export function formatIssues(issues: readonly ParseIssue[]): string {
  return issues
    .map((issue) =>
      issue.line === undefined ? `- ${issue.message}` : `- Zeile ${issue.line}: ${issue.message}`,
    )
    .join('\n');
}
