import type { CorrectionProfile } from '../src/annotations/profile.ts';
import type { Mark, Transcript } from '../src/annotations/transcript.ts';
import type { ChatMessage, PromptVariant } from './correct-prompts.ts';

const CHECKLIST =
  'Achte besonders auf: das/dass, fehlende Kommas vor Nebensätzen, Infinitivgruppen und in Aufzählungen, Groß- und Kleinschreibung (Nomen, Satzanfang), Fälle (Akkusativ, Dativ, Genitiv), die Übereinstimmung von Subjekt und Verbform sowie Zeitformen.';

export function diffMessages(
  profile: CorrectionProfile,
  input: Transcript,
  variant: PromptVariant,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        `Du korrigierst die Fehler in einer Schülerarbeit. Fach: ${profile.subject}.`,
        'Die Eingabe besteht aus nummerierten Zeilen. Gib genau dieselben Zeilen mit derselben Nummerierung aus, in denen die Fehler behoben sind: Rechtschreibung (auch Groß- und Kleinschreibung und Getrennt- und Zusammenschreibung), Zeichensetzung (fehlende oder falsche Kommas und andere Satzzeichen) und Grammatik (Fall, Zahl, Artikel, Verbform).',
        ...(variant === 'extended' ? [CHECKLIST] : []),
        'Ändere sonst nichts: keine Umformulierung, keine Stiländerung, keine neuen Sätze. Zeilen ohne Fehler bleiben unverändert. Gib nur die Zeilen aus, ohne Erklärung.',
      ].join('\n'),
    },
    { role: 'user', content: input.lines.map((line) => `${line.number}: ${line.text}`).join('\n') },
  ];
}

export function diffRepairMessages(
  messages: readonly ChatMessage[],
  answer: string,
  issues: readonly string[],
): ChatMessage[] {
  return [
    ...messages,
    { role: 'assistant', content: answer },
    {
      role: 'user',
      content: `Die Ausgabe ist nicht gültig:\n${issues.map((issue) => `- ${issue}`).join('\n')}\nGib alle Zeilen noch einmal mit ihrer Nummer aus.`,
    },
  ];
}

export function readCorrectedLines(
  input: Transcript,
  answer: string,
): { corrected: Map<number, string>; issues: string[] } {
  const corrected = new Map<number, string>();
  for (const row of answer.split('\n')) {
    const match = /^\s*(\d+)\s*[:.)]\s?(.*)$/.exec(row);
    if (match?.[1] !== undefined && !corrected.has(Number(match[1]))) {
      corrected.set(Number(match[1]), (match[2] ?? '').trim());
    }
  }
  const issues = input.lines
    .filter((line) => !corrected.has(line.number))
    .map((line) => `Zeile ${line.number} fehlt in der Ausgabe.`);
  return { corrected, issues };
}

interface Token {
  text: string;
  start: number;
  end: number;
}

const PUNCTUATION = /^[\p{P}\p{S}]+$/u;
const LEADING = /^[„“"'(]+/u;
const TRAILING = /[.,;:!?“"')]+$/u;

function tokenize(text: string): Token[] {
  return [...text.matchAll(/\S+/g)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

type Operation = { kind: 'equal' | 'replace'; from: number; to: number; with: number; by: number };

function align(a: readonly string[], b: readonly string[]): Operation[] {
  const columns = b.length + 1;
  const cost = new Uint32Array((a.length + 1) * columns);
  for (let j = 0; j <= b.length; j++) cost[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cost[i * columns] = i;
    for (let j = 1; j <= b.length; j++) {
      cost[i * columns + j] = Math.min(
        (cost[(i - 1) * columns + j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
        (cost[(i - 1) * columns + j] ?? 0) + 1,
        (cost[i * columns + j - 1] ?? 0) + 1,
      );
    }
  }
  const steps: ('equal' | 'sub' | 'del' | 'ins')[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    const here = cost[i * columns + j] ?? 0;
    if (
      i > 0 &&
      j > 0 &&
      a[i - 1] === b[j - 1] &&
      here === (cost[(i - 1) * columns + j - 1] ?? 0)
    ) {
      steps.push('equal');
      i--;
      j--;
    } else if (i > 0 && j > 0 && here === (cost[(i - 1) * columns + j - 1] ?? 0) + 1) {
      steps.push('sub');
      i--;
      j--;
    } else if (i > 0 && here === (cost[(i - 1) * columns + j] ?? 0) + 1) {
      steps.push('del');
      i--;
    } else {
      steps.push('ins');
      j--;
    }
  }
  steps.reverse();
  const operations: Operation[] = [];
  let x = 0;
  let y = 0;
  for (const step of steps) {
    const from = x;
    const withStart = y;
    if (step !== 'ins') x++;
    if (step !== 'del') y++;
    const kind = step === 'equal' ? 'equal' : 'replace';
    const last = operations.at(-1);
    if (last && last.kind === kind) {
      last.to = x;
      last.by = y;
    } else {
      operations.push({ kind, from, to: x, with: withStart, by: y });
    }
  }
  return operations;
}

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current.push(
        Math.min(
          (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
          (previous[j] ?? 0) + 1,
          (current[j - 1] ?? 0) + 1,
        ),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

const core = (text: string) => text.replaceAll(/[^\p{L}\p{N}\s]/gu, '').trim();

export function classify(original: string, fix: string): string {
  const before = core(original);
  const after = core(fix);
  if (before === after) return 'Z';
  const joinedBefore = before.replaceAll(/\s/g, '').toLowerCase();
  const joinedAfter = after.replaceAll(/\s/g, '').toLowerCase();
  if (joinedBefore === joinedAfter) return 'R';
  const single = !/\s/.test(before) && !/\s/.test(after);
  return single && distance(joinedBefore, joinedAfter) <= 2 ? 'R' : 'G';
}

const MAX_SPAN = 3;

function fold(text: string): string {
  return text
    .replaceAll(/[„“”«»]/g, '"')
    .replaceAll(/[‚‘’‹›]/g, "'")
    .replaceAll(/[–—]/g, '-');
}

export function diffMarks(text: string, corrected: string): Mark[] {
  const original = tokenize(text);
  const fixed = fold(corrected)
    .split(/\s+/)
    .filter((word) => word !== '');
  const marks: Mark[] = [];
  const operations = align(
    original.map((token) => fold(token.text)),
    fixed,
  )
    .filter(
      (operation) =>
        operation.to - operation.from <= MAX_SPAN && operation.by - operation.with <= MAX_SPAN,
    )
    .flatMap((operation) =>
      operation.kind === 'replace' &&
      operation.to - operation.from === operation.by - operation.with
        ? Array.from({ length: operation.to - operation.from }, (_, index) => ({
            ...operation,
            from: operation.from + index,
            to: operation.from + index + 1,
            with: operation.with + index,
            by: operation.with + index + 1,
          }))
        : [operation],
    );
  for (const operation of operations) {
    if (operation.kind === 'equal') continue;
    const removed = original.slice(operation.from, operation.to);
    const added = fixed.slice(operation.with, operation.by);
    const first = removed[0];
    const last = removed.at(-1);
    if (!first || !last) {
      const previous = original[operation.from - 1];
      const insertion = added.join(' ');
      marks.push({
        kind: 'omission',
        type: PUNCTUATION.test(insertion) ? 'Z' : 'G',
        original: '',
        correction: insertion,
        offset: previous ? previous.end : 0,
      });
      continue;
    }
    let before = text.slice(first.start, last.end);
    let after = added.join(' ');
    const trailing = TRAILING.exec(fold(before))?.[0] ?? '';
    if (trailing !== '' && after.endsWith(trailing) && before !== trailing && after !== trailing) {
      before = before.slice(0, before.length - trailing.length);
      after = after.slice(0, after.length - trailing.length);
    }
    const lead = LEADING.exec(fold(before))?.[0] ?? '';
    const stripped = lead !== '' && after.startsWith(lead) ? lead.length : 0;
    before = before.slice(stripped);
    after = after.slice(stripped);
    const offset = first.start + stripped;
    if (fold(before) === after) continue;
    if (
      after.startsWith(fold(before)) &&
      before !== '' &&
      PUNCTUATION.test(after.slice(before.length))
    ) {
      marks.push({
        kind: 'omission',
        type: 'Z',
        original: '',
        correction: after.slice(before.length),
        offset: offset + before.length,
      });
      continue;
    }
    marks.push({
      kind: 'error',
      type: after === '' ? (PUNCTUATION.test(before) ? 'Z' : 'G') : classify(before, after),
      original: before,
      correction: after,
      offset,
    });
  }
  return marks.toSorted((a, b) => a.offset - b.offset);
}

export function diffTranscript(
  input: Transcript,
  corrected: ReadonlyMap<number, string>,
): Transcript {
  return {
    lines: input.lines.map((line) => ({
      ...line,
      marks: diffMarks(line.text, corrected.get(line.number) ?? line.text),
    })),
  };
}
