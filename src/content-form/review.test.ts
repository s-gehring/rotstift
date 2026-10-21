import { describe, expect, it, vi } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { DEFAULT_SCOPE, type CorrectionScope } from '../correction/scope.ts';
import { findTextForm } from './catalog.ts';
import {
  MAX_FORM_NAME_LENGTH,
  cleanFormName,
  contentQuestions,
  needsAssignment,
  needsFormName,
  numberWorkLines,
  questionRequest,
  readAnswer,
  reviewContent,
  reviewsContent,
  summaryText,
  tidyComment,
  type AskQuestion,
  type ContentInput,
  type ContentQuestion,
  type WorkLine,
} from './review.ts';

const scope = (overrides: Partial<CorrectionScope>): CorrectionScope => ({
  ...DEFAULT_SCOPE,
  ...overrides,
});

const lines: WorkLine[] = [
  { pageId: 'p1', line: 1, text: 'Erste Zeile' },
  { pageId: 'p1', line: 2, text: '' },
  { pageId: 'p2', line: 1, text: 'Dritte Zeile' },
  { pageId: 'p2', line: 2, text: 'Vierte Zeile' },
];

const input = (overrides: Partial<CorrectionScope>): ContentInput => ({
  lines,
  profile: DEUTSCH,
  scope: scope(overrides),
});

const signal = () => new AbortController().signal;

const answer = (value: { erfuellt: boolean; zeile: number; kommentar?: string }) =>
  JSON.stringify(value);

function askWith(...answers: string[]) {
  let index = 0;
  const ask = vi.fn<AskQuestion>(() => Promise.resolve(answers[index++] ?? answers.at(-1) ?? ''));
  return ask;
}

describe('cleanFormName', () => {
  it('collapses whitespace and strips angle brackets', () => {
    expect(cleanFormName('  Persönlicher \n <Brief>  ')).toBe('Persönlicher Brief');
  });

  it('limits the length', () => {
    expect(Array.from(cleanFormName('a'.repeat(200))).length).toBe(MAX_FORM_NAME_LENGTH);
  });
});

describe('scope predicates', () => {
  it('needs an assignment only when content is requested and the assignment is blank', () => {
    expect(needsAssignment(scope({ content: true, assignment: '  ' }))).toBe(true);
    expect(needsAssignment(scope({ content: true, assignment: 'Schreibe' }))).toBe(false);
    expect(needsAssignment(scope({ content: false, assignment: '' }))).toBe(false);
  });

  it('needs a form name only when form is requested and the name is blank', () => {
    expect(needsFormName(scope({ form: true, formName: ' ' }))).toBe(true);
    expect(needsFormName(scope({ form: true, formName: 'Brief' }))).toBe(false);
    expect(needsFormName(scope({ form: false, formName: '' }))).toBe(false);
  });

  it('reviews content when a requested kind has its input', () => {
    expect(reviewsContent(scope({}))).toBe(false);
    expect(reviewsContent(scope({ content: true, assignment: '' }))).toBe(false);
    expect(reviewsContent(scope({ content: true, assignment: 'A' }))).toBe(true);
    expect(reviewsContent(scope({ form: true, formName: '' }))).toBe(false);
    expect(reviewsContent(scope({ form: true, formName: 'Brief' }))).toBe(true);
  });
});

describe('contentQuestions', () => {
  it('uses the fixed comments of a known form', () => {
    const questions = contentQuestions(scope({ form: true, formName: 'e-mail' }));
    const features = findTextForm('E-Mail')?.features ?? [];
    expect(questions).toHaveLength(features.length);
    expect(questions.every((question) => question.kind === 'form')).toBe(true);
    expect(questions.map((question) => question.comment)).toEqual(
      features.map((entry) => entry.comment),
    );
  });

  it('asks one generic question for an unknown form', () => {
    expect(contentQuestions(scope({ form: true, formName: 'Gedicht' }))).toEqual([
      { kind: 'form', question: 'Entspricht der Text der Textform „Gedicht“?', comment: null },
    ]);
  });

  it('adds the task questions after the form questions', () => {
    const questions = contentQuestions(
      scope({ form: true, formName: 'Gedicht', content: true, assignment: 'Schreibe.' }),
    );
    expect(questions.map((question) => question.kind)).toEqual(['form', 'content', 'content']);
    expect(questions.slice(1).every((question) => question.comment === null)).toBe(true);
  });

  it('has no task questions without an assignment', () => {
    expect(contentQuestions(scope({ content: true, assignment: ' ' }))).toEqual([]);
  });

  it('has no form questions without a form name or when form is off', () => {
    expect(contentQuestions(scope({ form: true, formName: ' ' }))).toEqual([]);
    expect(contentQuestions(scope({ form: false, formName: 'Brief' }))).toEqual([]);
  });
});

describe('numberWorkLines', () => {
  it('numbers across pages and skips blank lines', () => {
    expect(numberWorkLines(lines)).toBe('1: Erste Zeile\n3: Dritte Zeile\n4: Vierte Zeile');
  });

  it('returns an empty string for no lines', () => {
    expect(numberWorkLines([])).toBe('');
  });
});

describe('questionRequest', () => {
  const generic: ContentQuestion = { kind: 'content', question: 'Frage?', comment: null };
  const fixed: ContentQuestion = { kind: 'form', question: 'Frage?', comment: 'Fest' };

  it('limits zeile to the number of lines', () => {
    const { schema } = questionRequest(input({}), fixed);
    expect(schema).toMatchObject({
      properties: { zeile: { minimum: 1, maximum: 4 } },
      additionalProperties: false,
    });
  });

  it('asks for a comment only when the question has no fixed one', () => {
    const withComment = questionRequest(input({}), generic).schema;
    const without = questionRequest(input({}), fixed).schema;
    expect(withComment).toMatchObject({
      properties: { kommentar: { type: 'string' } },
      required: ['erfuellt', 'zeile', 'kommentar'],
    });
    expect(without).toMatchObject({ required: ['erfuellt', 'zeile'] });
    expect(without).not.toHaveProperty('properties.kommentar');
  });

  it('allows at least line 1 for empty input', () => {
    const { schema } = questionRequest({ ...input({}), lines: [] }, fixed);
    expect(schema).toMatchObject({ properties: { zeile: { maximum: 1 } } });
  });

  it('puts the assignment inside aufgabe in the system message', () => {
    const { messages } = questionRequest(
      input({ content: true, assignment: 'Schreibe über <b>Ferien</b>.' }),
      generic,
    );
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('<aufgabe>\nSchreibe über bFerien/b.\n</aufgabe>');
    expect(messages[1]?.content).toContain('1: Erste Zeile');
    expect(messages[1]?.content).toContain('Frage: Frage?');
  });

  it('omits aufgabe without an assignment', () => {
    const { messages } = questionRequest(input({ form: true, formName: 'Brief' }), fixed);
    expect(messages[0]?.content).not.toContain('<aufgabe>');
    expect(messages[0]?.content).toContain('Verlangte Textform: Brief.');
  });
});

describe('tidyComment', () => {
  it('collapses whitespace and removes angle brackets', () => {
    expect(tidyComment('  Thema \n <fehlt>  ')).toBe('Thema fehlt');
  });

  it('drops trailing punctuation', () => {
    expect(tidyComment('Thema verfehlt, ')).toBe('Thema verfehlt');
  });

  it('keeps at most eight words', () => {
    expect(tidyComment('a b c d e f g h i j')).toBe('a b c d e f g h');
  });

  it('drops a probably cut last word at the length limit', () => {
    const text = `${'wort '.repeat(11)}abgesc`;
    expect(Array.from(text).length).toBeGreaterThanOrEqual(60);
    expect(tidyComment(text)).not.toContain('abgesc');
  });

  it('returns an empty string for blank input', () => {
    expect(tidyComment('   ')).toBe('');
  });
});

describe('readAnswer', () => {
  const generic: ContentQuestion = { kind: 'content', question: 'F?', comment: null };
  const fixed: ContentQuestion = { kind: 'form', question: 'F?', comment: 'Fest' };

  it('returns null for invalid JSON or a wrong shape', () => {
    expect(readAnswer('nope', generic, 4)).toBeNull();
    expect(readAnswer('', generic, 4)).toBeNull();
    expect(readAnswer('{"erfuellt":"ja","zeile":1}', generic, 4)).toBeNull();
    expect(readAnswer('{"erfuellt":true,"zeile":1.5}', generic, 4)).toBeNull();
  });

  it('clamps the line into the valid range', () => {
    expect(
      readAnswer(answer({ erfuellt: false, zeile: 99, kommentar: 'x' }), generic, 4)?.line,
    ).toBe(4);
    expect(
      readAnswer(answer({ erfuellt: false, zeile: -3, kommentar: 'x' }), generic, 4)?.line,
    ).toBe(1);
    expect(readAnswer(answer({ erfuellt: false, zeile: 5 }), generic, 0)?.line).toBe(1);
  });

  it('uses the fixed comment of the question', () => {
    expect(readAnswer(answer({ erfuellt: false, zeile: 1, kommentar: 'egal' }), fixed, 4)).toEqual({
      met: false,
      line: 1,
      text: 'Fest',
    });
  });

  it('uses the tidied model comment and falls back to a default', () => {
    expect(
      readAnswer(answer({ erfuellt: false, zeile: 2, kommentar: ' Thema  fehlt ' }), generic, 4)
        ?.text,
    ).toBe('Thema fehlt');
    expect(readAnswer(answer({ erfuellt: false, zeile: 2, kommentar: '' }), generic, 4)?.text).toBe(
      'Aufgabe nicht erfüllt',
    );
  });
});

describe('reviewContent', () => {
  const contentScope = { content: true, assignment: 'Schreibe.' };

  it('maps a blank line to the nearest non-blank line, preferring the following one', async () => {
    const result = await reviewContent(
      input({ form: true, formName: 'Gedicht' }),
      askWith(answer({ erfuellt: false, zeile: 2, kommentar: 'Reim fehlt' })),
      signal(),
    );
    expect(result).toEqual({
      ok: true,
      comments: [{ pageId: 'p2', line: 1, kind: 'form', text: 'Reim fehlt' }],
      questions: 1,
    });
  });

  it('reports nothing for met questions', async () => {
    const result = await reviewContent(
      input(contentScope),
      askWith(answer({ erfuellt: true, zeile: 1 })),
      signal(),
    );
    expect(result).toEqual({ ok: true, comments: [], questions: 2 });
  });

  it('drops comments with the same text', async () => {
    const result = await reviewContent(
      input({ form: true, formName: 'Brief' }),
      askWith(answer({ erfuellt: false, zeile: 1 })),
      signal(),
    );
    expect(result.ok && result.comments.map((comment) => comment.text)).toEqual([
      'Ort und Datum fehlen',
      'Anrede fehlt',
      'Grußformel fehlt',
    ]);
    const same = await reviewContent(
      input(contentScope),
      askWith(answer({ erfuellt: false, zeile: 1, kommentar: 'Thema verfehlt' })),
      signal(),
    );
    expect(same.ok && same.comments).toHaveLength(1);
  });

  it('keeps only one content comment', async () => {
    const result = await reviewContent(
      input(contentScope),
      askWith(
        answer({ erfuellt: false, zeile: 1, kommentar: 'Thema verfehlt' }),
        answer({ erfuellt: false, zeile: 3, kommentar: 'Vorgabe fehlt' }),
      ),
      signal(),
    );
    expect(result.ok && result.comments).toEqual([
      { pageId: 'p1', line: 1, kind: 'content', text: 'Thema verfehlt' },
    ]);
  });

  it('skips invalid answers but fails when none is valid', async () => {
    const partial = await reviewContent(
      input(contentScope),
      askWith('kaputt', answer({ erfuellt: false, zeile: 3, kommentar: 'Vorgabe fehlt' })),
      signal(),
    );
    expect(partial.ok && partial.comments).toHaveLength(1);
    const none = await reviewContent(input(contentScope), askWith('kaputt'), signal());
    expect(none).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'Das Modell hat keine gültigen Antworten geliefert' },
    });
  });

  it('asks nothing when there are no questions', async () => {
    const ask = askWith('x');
    const result = await reviewContent(input({}), ask, signal());
    expect(result).toEqual({ ok: true, comments: [], questions: 0 });
    expect(ask).not.toHaveBeenCalled();
  });

  it('ignores comments when all lines are blank', async () => {
    const blank = { ...input(contentScope), lines: [{ pageId: 'p1', line: 1, text: ' ' }] };
    const result = await reviewContent(
      blank,
      askWith(answer({ erfuellt: false, zeile: 1, kommentar: 'x' })),
      signal(),
    );
    expect(result).toEqual({ ok: true, comments: [], questions: 2 });
  });

  it('throws when the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const ask = askWith('x');
    await expect(reviewContent(input(contentScope), ask, controller.signal)).rejects.toThrow(
      /abort/iu,
    );
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('summaryText', () => {
  it('lists content and form comments', () => {
    expect(
      summaryText([
        { kind: 'content', text: 'a' },
        { kind: 'form', text: 'b' },
        { kind: 'form', text: 'c' },
      ]),
    ).toBe('Inhalt: a. Form: b, c.');
  });

  it('leaves out an empty part', () => {
    expect(summaryText([{ kind: 'form', text: 'b' }])).toBe('Form: b.');
    expect(summaryText([{ kind: 'content', text: 'a' }])).toBe('Inhalt: a.');
  });

  it('returns null without comments', () => {
    expect(summaryText([])).toBeNull();
  });
});
