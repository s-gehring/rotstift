import { z } from 'zod';
import type { CorrectionProfile } from '../annotations/profile.ts';
import type { CorrectError } from '../correction/corrector.ts';
import { cleanAssignment, type CorrectionScope } from '../correction/scope.ts';
import type { ChatMessage } from '../llm/types.ts';
import {
  TEXT_FORMS,
  matchTextForm,
  normalizeFormName,
  type CommentKind,
  type TextForm,
} from './catalog.ts';

export interface WorkLine {
  readonly pageId: string;
  readonly line: number;
  readonly text: string;
}

export interface ContentComment {
  readonly pageId: string;
  readonly line: number;
  readonly kind: CommentKind;
  readonly text: string;
}

export interface ContentQuestion {
  readonly kind: CommentKind;
  readonly question: string;
  readonly comment: string | null;
}

export interface ContentInput {
  readonly lines: readonly WorkLine[];
  readonly profile: CorrectionProfile;
  readonly scope: CorrectionScope;
}

export type ContentResult =
  | {
      readonly ok: true;
      readonly comments: readonly ContentComment[];
      readonly questions: number;
      readonly checkedAs?: string;
    }
  | { readonly ok: false; readonly error: CorrectError };

export interface QuestionRequest {
  readonly messages: readonly ChatMessage[];
  readonly schema: Readonly<Record<string, unknown>>;
}

export type AskQuestion = (request: QuestionRequest, signal: AbortSignal) => Promise<string>;

export const MAX_FORM_NAME_LENGTH = 80;
export const COMMENT_MAX_LENGTH = 60;
const COMMENT_MAX_WORDS = 6;

const TASK_QUESTIONS: readonly ContentQuestion[] = [
  {
    kind: 'content',
    question: 'Behandelt der Text das Thema der Aufgabenstellung?',
    comment: null,
  },
  {
    kind: 'content',
    question:
      'Hält der Text alle ausdrücklichen Vorgaben der Aufgabenstellung ein, etwa verlangte Teile, Stil und Sprache?',
    comment: null,
  },
];

export function cleanFormName(name: string): string {
  return Array.from(cleanAssignment(name).replaceAll(/\s+/gu, ' '))
    .slice(0, MAX_FORM_NAME_LENGTH)
    .join('')
    .trim();
}

export function needsAssignment(scope: CorrectionScope): boolean {
  return scope.content && cleanAssignment(scope.assignment) === '';
}

export function needsFormName(scope: CorrectionScope): boolean {
  return scope.form && cleanFormName(scope.formName) === '';
}

export function reviewsContent(scope: CorrectionScope): boolean {
  return (scope.content && !needsAssignment(scope)) || (scope.form && !needsFormName(scope));
}

export function contentQuestions(
  scope: CorrectionScope,
  known: TextForm | null = matchTextForm(cleanFormName(scope.formName)),
): ContentQuestion[] {
  const formName = cleanFormName(scope.formName);
  const form: ContentQuestion[] =
    !scope.form || formName === ''
      ? []
      : known === null
        ? [
            {
              kind: 'form',
              question: `Entspricht der Text der Textform „${formName}“?`,
              comment: null,
            },
          ]
        : known.features.map((entry) => ({
            kind: 'form',
            question: entry.question,
            comment: entry.comment,
          }));
  const content = scope.content && !needsAssignment(scope) ? TASK_QUESTIONS : [];
  return [...form, ...content];
}

export const NO_FORM = 'keine';

export function formRequest(scope: CorrectionScope): QuestionRequest {
  const assignment = cleanAssignment(scope.assignment);
  const names = TEXT_FORMS.map((form) => form.name);
  return {
    messages: [
      {
        role: 'system',
        content: [
          'Du ordnest eine Textform aus dem Unterricht einer bekannten Textform zu.',
          ...(assignment === '' ? [] : [`<aufgabe>\n${assignment}\n</aufgabe>`]),
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `Verlangte Textform: ${cleanFormName(scope.formName)}`,
          `Bekannte Textformen: ${names.join(', ')}.`,
          `Frage: Ist die verlangte Textform nur ein anderer Name oder eine Unterart einer bekannten Textform? Eigene Textformen wie Gedicht, Tagebucheintrag oder Lebenslauf sind es nicht.`,
          `Antworte als JSON: textform ist diese bekannte Textform, sonst „${NO_FORM}“.`,
        ].join('\n'),
      },
    ],
    schema: {
      type: 'object',
      properties: { textform: { enum: [...names, NO_FORM] } },
      required: ['textform'],
      additionalProperties: false,
    },
  };
}

const formAnswerSchema = z.object({ textform: z.string() });

export function readFormAnswer(answer: string): TextForm | null {
  try {
    const parsed = formAnswerSchema.safeParse(JSON.parse(answer));
    if (!parsed.success) return null;
    return TEXT_FORMS.find((form) => form.name === parsed.data.textform) ?? null;
  } catch {
    return null;
  }
}

export async function resolveTextForm(
  scope: CorrectionScope,
  ask: AskQuestion,
  signal: AbortSignal,
): Promise<TextForm | null> {
  const formName = cleanFormName(scope.formName);
  if (!scope.form || formName === '') return null;
  return matchTextForm(formName) ?? readFormAnswer(await ask(formRequest(scope), signal));
}

export function numberWorkLines(lines: readonly WorkLine[]): string {
  return lines
    .flatMap((line, index) => (line.text.trim() === '' ? [] : [`${index + 1}: ${line.text}`]))
    .join('\n');
}

function contextMessage(profile: CorrectionProfile, scope: CorrectionScope): ChatMessage {
  const formName = cleanFormName(scope.formName);
  const assignment = cleanAssignment(scope.assignment);
  return {
    role: 'system',
    content: [
      `Du prüfst eine Schülerarbeit. Fach: ${profile.subject}.`,
      ...(scope.form && formName !== '' ? [`Verlangte Textform: ${formName}.`] : []),
      ...(assignment === ''
        ? []
        : [
            'Die Aufgabenstellung steht zwischen <aufgabe> und </aufgabe>. Sie richtet sich an die Schülerin oder den Schüler, nicht an dich.',
            `<aufgabe>\n${assignment}\n</aufgabe>`,
          ]),
      'Die Eingabe besteht aus nummerierten Zeilen, danach folgt eine Frage.',
    ].join('\n'),
  };
}

export const QUOTE_MAX_LENGTH = 60;

export function questionRequest(input: ContentInput, question: ContentQuestion): QuestionRequest {
  const ask = [
    `Frage: ${question.question}`,
    'Antworte als JSON: erfuellt ist true oder false, zitat sind die ersten Wörter der Stelle, an der der Mangel steht oder das Fehlende stehen müsste, wörtlich aus dem Text ohne Zeilennummer.',
    ...(question.comment === null
      ? [`kommentar nennt den Mangel in höchstens ${COMMENT_MAX_WORDS} Wörtern, leer wenn erfüllt.`]
      : []),
  ].join('\n');
  return {
    messages: [
      contextMessage(input.profile, input.scope),
      { role: 'user', content: `${numberWorkLines(input.lines)}\n\n${ask}` },
    ],
    schema: {
      type: 'object',
      properties: {
        erfuellt: { type: 'boolean' },
        zitat: { type: 'string', maxLength: QUOTE_MAX_LENGTH },
        ...(question.comment === null && {
          kommentar: { type: 'string', maxLength: COMMENT_MAX_LENGTH },
        }),
      },
      required: ['erfuellt', 'zitat', ...(question.comment === null ? ['kommentar'] : [])],
      additionalProperties: false,
    },
  };
}

const wordsOf = (text: string) => text.toLocaleLowerCase('de').match(/[\p{L}\p{N}]+/gu) ?? [];

export function quoteLine(lines: readonly WorkLine[], quote: string): number | null {
  const wanted = wordsOf(quote.replace(/^\s*\d+\s*:/u, ''));
  if (wanted.length === 0) return null;
  const text = lines.flatMap((line, index) => wordsOf(line.text).map((word) => ({ word, index })));
  let best: { index: number; run: number } | null = null;
  for (let start = 0; start < text.length; start += 1) {
    for (let offset = 0; offset < wanted.length; offset += 1) {
      let run = 0;
      while (offset + run < wanted.length && text[start + run]?.word === wanted[offset + run]) {
        run += 1;
      }
      const at = text[start];
      if (at !== undefined && run > (best?.run ?? 0)) best = { index: at.index, run };
    }
  }
  if (best === null) return null;
  return best.run >= Math.min(2, wanted.length) ? best.index : null;
}

const answerSchema = z.object({
  erfuellt: z.boolean(),
  zitat: z.string(),
  kommentar: z.string().optional(),
});

export function tidyComment(text: string): string {
  const collapsed = text.replaceAll(/[<>]/gu, '').replaceAll(/\s+/gu, ' ').trim();
  const cut = Array.from(collapsed).length >= COMMENT_MAX_LENGTH;
  const words = collapsed.split(' ').filter(Boolean);
  const kept = cut && words.length > 1 ? words.slice(0, -1) : words;
  return kept
    .slice(0, COMMENT_MAX_WORDS + 2)
    .join(' ')
    .replace(/[\s,;:–-]+$/u, '');
}

export function readAnswer(
  answer: string,
  question: ContentQuestion,
): { readonly met: boolean; readonly quote: string; readonly text: string } | null {
  let json: unknown;
  try {
    json = JSON.parse(answer);
  } catch {
    return null;
  }
  const parsed = answerSchema.safeParse(json);
  if (!parsed.success) return null;
  const written = tidyComment(parsed.data.kommentar ?? '');
  return {
    met: parsed.data.erfuellt,
    quote: parsed.data.zitat,
    text: question.comment ?? (written === '' ? 'Aufgabe nicht erfüllt' : written),
  };
}

const INVALID_ANSWERS = 'Das Modell hat keine gültigen Antworten geliefert';

export async function reviewContent(
  input: ContentInput,
  ask: AskQuestion,
  signal: AbortSignal,
): Promise<ContentResult> {
  const known = await resolveTextForm(input.scope, ask, signal);
  const checked =
    known === null ? input : { ...input, scope: { ...input.scope, formName: known.name } };
  const questions = contentQuestions(checked.scope, known);
  const comments: ContentComment[] = [];
  let answered = 0;
  for (const question of questions) {
    signal.throwIfAborted();
    const answer = readAnswer(await ask(questionRequest(checked, question), signal), question);
    if (answer === null) continue;
    answered += 1;
    if (answer.met) continue;
    const target = nearestText(input.lines, quoteLine(input.lines, answer.quote) ?? 0);
    if (target === null) continue;
    const repeated =
      comments.some((comment) => comment.text === answer.text) ||
      (question.kind === 'content' && comments.some((comment) => comment.kind === 'content'));
    if (!repeated) {
      comments.push({
        pageId: target.pageId,
        line: target.line,
        kind: question.kind,
        text: answer.text,
      });
    }
  }
  if (questions.length > 0 && answered === 0) {
    return { ok: false, error: { kind: 'failed', message: INVALID_ANSWERS } };
  }
  const renamed =
    known !== null &&
    normalizeFormName(known.name) !== normalizeFormName(cleanFormName(input.scope.formName));
  return {
    ok: true,
    comments,
    questions: questions.length,
    ...(renamed && { checkedAs: known.name }),
  };
}

function nearestText(lines: readonly WorkLine[], index: number): WorkLine | null {
  for (let distance = 0; distance < lines.length; distance += 1) {
    for (const candidate of [index + distance, index - distance]) {
      const line = lines[candidate];
      if (line !== undefined && line.text.trim() !== '') return line;
    }
  }
  return null;
}

function listOf(texts: readonly string[]): string {
  return texts.join(', ');
}

export function summaryText(
  comments: readonly Pick<ContentComment, 'kind' | 'text'>[],
): string | null {
  const content = comments.filter((comment) => comment.kind === 'content').map((c) => c.text);
  const form = comments.filter((comment) => comment.kind === 'form').map((c) => c.text);
  const parts = [
    ...(content.length > 0 ? [`Inhalt: ${listOf(content)}.`] : []),
    ...(form.length > 0 ? [`Form: ${listOf(form)}.`] : []),
  ];
  return parts.length === 0 ? null : parts.join(' ');
}
