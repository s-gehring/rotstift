import { z } from 'zod';
import { findErrorKind } from './catalog.ts';
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
  profile?: CorrectionProfile;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function isElement(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE;
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
  fix: z.string({ error: 'Pflichtattribut fix fehlt (eine leere Korrektur ist fix="").' }),
});

interface LineState {
  position: number;
  number: number | undefined;
  text: string;
  marks: Mark[];
}

class Collector {
  readonly issues: ParseIssue[] = [];

  constructor(private readonly profile: CorrectionProfile | undefined) {}

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
    if (!profile) {
      return raw;
    }
    const kind = findErrorKind(profile.language, raw);
    const allowed = profile.allowedTypes.join(', ');
    if (!kind) {
      this.report(line, `<${tag}>: Unbekannter Fehlertyp „${raw}“. Erlaubt sind: ${allowed}.`);
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
        collector.report(line, `Unbekanntes Element <${name}> in <${tag}>.`);
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
      `<rs-error>: Die Korrektur „${attributes.fix}“ ist identisch mit dem Originaltext.`,
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
          collector.report(line, `Unbekanntes Element <${element.localName}> in der Zeile.`);
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
  const attributes = collector.attributes(line, 'rs-line', lineAttributes, element, ['n', 'bbox']);
  line.number = attributes?.n;

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

function stripCodeFence(html: string): string {
  const match = /^\s*```[a-z]*[ \t]*\r?\n([\s\S]*?)\r?\n?```\s*$/i.exec(html);
  return match?.[1] ?? html;
}

export function parseTranscript(html: string, options: ParseOptions = {}): ParseResult {
  const collector = new Collector(options.profile);
  const document = new DOMParser().parseFromString(stripCodeFence(html), 'text/html');
  const lines: TranscriptLine[] = [];
  let position = 0;

  for (const node of document.body.childNodes) {
    if (node.nodeType === TEXT_NODE) {
      const text = (node.textContent ?? '').trim();
      if (text !== '') {
        collector.report(
          undefined,
          `Text außerhalb einer Zeile: „${text.slice(0, 60)}“. Der gesamte Text muss in <rs-line>-Elementen stehen.`,
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
          `<${element.localName}> steht außerhalb einer <rs-line>. Auf oberster Ebene sind nur <rs-line>-Elemente erlaubt.`,
        );
      }
    }
  }

  if (position === 0 && collector.issues.length === 0) {
    collector.report(undefined, 'Die Ausgabe enthält keine <rs-line>-Zeile.');
  }

  const checked = transcriptSchema.safeParse({ lines });
  if (checked.success) {
    return collector.issues.length === 0
      ? { ok: true, transcript: checked.data }
      : { ok: false, issues: collector.issues };
  }
  for (const issue of checked.error.issues) {
    const index = issue.path[1];
    const number = typeof index === 'number' ? lines[index]?.number : undefined;
    collector.issues.push({
      message: issue.message,
      ...(number === undefined ? {} : { line: number }),
    });
  }
  return { ok: false, issues: collector.issues };
}

export function formatIssues(issues: readonly ParseIssue[]): string {
  return issues
    .map((issue) =>
      issue.line === undefined ? `- ${issue.message}` : `- Zeile ${issue.line}: ${issue.message}`,
    )
    .join('\n');
}
