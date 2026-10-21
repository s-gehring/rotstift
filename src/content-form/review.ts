import { z } from 'zod';
import type { CorrectionProfile } from '../annotations/profile.ts';
import type { CorrectError } from '../correction/corrector.ts';
import { cleanAssignment, type CorrectionScope } from '../correction/scope.ts';
import type { ChatMessage } from '../llm/types.ts';
import { findTextForm, type CommentKind } from './catalog.ts';

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
  | { readonly ok: true; readonly comments: readonly ContentComment[]; readonly questions: number }
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

export function contentQuestions(scope: CorrectionScope): ContentQuestion[] {
  const formName = cleanFormName(scope.formName);
  const known = findTextForm(formName);
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

export function questionRequest(input: ContentInput, question: ContentQuestion): QuestionRequest {
  const ask = [
    `Frage: ${question.question}`,
    'Antworte als JSON: erfuellt ist true oder false, zeile ist die Zeile, an der der Mangel steht oder das Fehlende stehen müsste.',
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
        zeile: { type: 'integer', minimum: 1, maximum: Math.max(1, input.lines.length) },
        ...(question.comment === null && {
          kommentar: { type: 'string', maxLength: COMMENT_MAX_LENGTH },
        }),
      },
      required: ['erfuellt', 'zeile', ...(question.comment === null ? ['kommentar'] : [])],
      additionalProperties: false,
    },
  };
}

const answerSchema = z.object({
  erfuellt: z.boolean(),
  zeile: z.number().int(),
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
  lineCount: number,
): { readonly met: boolean; readonly line: number; readonly text: string } | null {
  let json: unknown;
  try {
    json = JSON.parse(answer);
  } catch {
    return null;
  }
  const parsed = answerSchema.safeParse(json);
  if (!parsed.success) return null;
  const line = Math.min(Math.max(parsed.data.zeile, 1), Math.max(lineCount, 1));
  const written = tidyComment(parsed.data.kommentar ?? '');
  return {
    met: parsed.data.erfuellt,
    line,
    text: question.comment ?? (written === '' ? 'Aufgabe nicht erfüllt' : written),
  };
}

const INVALID_ANSWERS = 'Das Modell hat keine gültigen Antworten geliefert';

export async function reviewContent(
  input: ContentInput,
  ask: AskQuestion,
  signal: AbortSignal,
): Promise<ContentResult> {
  const questions = contentQuestions(input.scope);
  const comments: ContentComment[] = [];
  let answered = 0;
  for (const question of questions) {
    signal.throwIfAborted();
    const answer = readAnswer(
      await ask(questionRequest(input, question), signal),
      question,
      input.lines.length,
    );
    if (answer === null) continue;
    answered += 1;
    if (answer.met) continue;
    const target = nearestText(input.lines, answer.line - 1);
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
  return { ok: true, comments, questions: questions.length };
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
