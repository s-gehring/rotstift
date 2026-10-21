import { describe, expect, it, vi } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { DEFAULT_SCOPE, type CorrectionScope } from '../correction/scope.ts';
import { TEXT_FORMS, findTextForm } from './catalog.ts';
import {
  MAX_FORM_NAME_LENGTH,
  cleanFormName,
  NO_FORM,
  contentQuestions,
  formRequest,
  needsAssignment,
  needsFormName,
  numberWorkLines,
  questionRequest,
  QUOTE_MAX_LENGTH,
  quoteLine,
  readAnswer,
  readFormAnswer,
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

const answer = (value: { erfuellt: boolean; zitat: string; kommentar?: string }) =>
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

describe('formRequest', () => {
  it('offers every catalogue form and none as an enum without the student text', () => {
    const request = formRequest(
      scope({ form: true, formName: 'Argumentation', assignment: 'Erörtere.' }),
    );
    expect(request.schema).toEqual({
      type: 'object',
      properties: { textform: { enum: [...TEXT_FORMS.map((form) => form.name), NO_FORM] } },
      required: ['textform'],
      additionalProperties: false,
    });
    const text = JSON.stringify(request.messages);
    expect(text).toContain('Verlangte Textform: Argumentation');
    expect(text).toContain('<aufgabe>\\nErörtere.\\n</aufgabe>');
    expect(text).not.toContain('Erste Zeile');
  });
});

describe('readFormAnswer', () => {
  it('returns the chosen catalogue form', () => {
    expect(readFormAnswer('{"textform":"Lineare Erörterung"}')?.name).toBe('Lineare Erörterung');
  });

  it.each([`{"textform":"${NO_FORM}"}`, '{"textform":"Gedicht"}', 'kaputt', '{}'])(
    'returns null for %s',
    (raw) => {
      expect(readFormAnswer(raw)).toBeNull();
    },
  );
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

  it('asks for a short quote instead of a line number', () => {
    const { schema, messages } = questionRequest(input({}), fixed);
    expect(schema).toMatchObject({
      properties: { zitat: { type: 'string', maxLength: QUOTE_MAX_LENGTH } },
      additionalProperties: false,
    });
    expect(schema).not.toHaveProperty('properties.zeile');
    expect(messages[1]?.content).toContain('zitat sind die ersten Wörter der Stelle');
  });

  it('asks for a comment only when the question has no fixed one', () => {
    const withComment = questionRequest(input({}), generic).schema;
    const without = questionRequest(input({}), fixed).schema;
    expect(withComment).toMatchObject({
      properties: { kommentar: { type: 'string' } },
      required: ['erfuellt', 'zitat', 'kommentar'],
    });
    expect(without).toMatchObject({ required: ['erfuellt', 'zitat'] });
    expect(without).not.toHaveProperty('properties.kommentar');
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
    expect(readAnswer('nope', generic)).toBeNull();
    expect(readAnswer('', generic)).toBeNull();
    expect(readAnswer('{"erfuellt":"ja","zitat":"x"}', generic)).toBeNull();
    expect(readAnswer('{"erfuellt":true}', generic)).toBeNull();
  });

  it('uses the fixed comment of the question', () => {
    expect(
      readAnswer(answer({ erfuellt: false, zitat: 'Hallo', kommentar: 'egal' }), fixed),
    ).toEqual({ met: false, quote: 'Hallo', text: 'Fest' });
  });

  it('uses the tidied model comment and falls back to a default', () => {
    expect(
      readAnswer(answer({ erfuellt: false, zitat: 'x', kommentar: ' Thema  fehlt ' }), generic)
        ?.text,
    ).toBe('Thema fehlt');
    expect(readAnswer(answer({ erfuellt: false, zitat: 'x', kommentar: '' }), generic)?.text).toBe(
      'Aufgabe nicht erfüllt',
    );
  });
});

const page = (...texts: string[]): WorkLine[] =>
  texts.map((text, index) => ({ pageId: 'p', line: index + 1, text }));

describe('quoteLine', () => {
  it('finds the line where the quoted words start, ignoring case and punctuation', () => {
    const letter = page('Hallo Leute, ich bin', 'Mira und ich frage, ob ihr noch', 'Plätze habt.');
    expect(quoteLine(letter, 'ob Ihr noch Plätze')).toBe(1);
    expect(quoteLine(letter, '„Hallo Leute“')).toBe(0);
  });

  it('strips a line number the model copied', () => {
    expect(quoteLine(page('Erste Zeile', 'Zweite Zeile'), '2: Zweite Zeile')).toBe(1);
  });

  it('tolerates a wrong first word', () => {
    expect(quoteLine(page('Es war einmal', 'ein Fuchs im Wald'), 'Der Fuchs im Wald')).toBe(1);
  });

  it('returns null when fewer than two words match', () => {
    const two = page('Erste Zeile', 'Zweite Zeile');
    expect(quoteLine(two, 'Bewerbungsschreiben')).toBeNull();
    expect(quoteLine(two, 'Zeile drei vier')).toBeNull();
    expect(quoteLine(two, '')).toBeNull();
  });

  it('accepts a single quoted word that occurs', () => {
    expect(quoteLine(page('Hallo', 'Ciao'), 'Ciao')).toBe(1);
  });
});

describe('reviewContent', () => {
  const contentScope = { content: true, assignment: 'Schreibe.' };

  it('places a comment at the quoted line across pages', async () => {
    const result = await reviewContent(
      input({ form: true, formName: 'Gedicht' }),
      askWith(answer({ erfuellt: false, zitat: 'Vierte Zeile', kommentar: 'Reim fehlt' })),
      signal(),
    );
    expect(result).toEqual({
      ok: true,
      comments: [{ pageId: 'p2', line: 2, kind: 'form', text: 'Reim fehlt' }],
      questions: 1,
    });
  });

  it('falls back to the first written line when the quote is not in the text', async () => {
    const result = await reviewContent(
      input({ form: true, formName: 'Gedicht' }),
      askWith(answer({ erfuellt: false, zitat: 'Reim und Strophe', kommentar: 'Reim fehlt' })),
      signal(),
    );
    expect(result.ok && result.comments.map((comment) => comment.line)).toEqual([1]);
  });

  it('asks the catalogue features of the form the model picks for an unknown name', async () => {
    const ask = askWith(
      '{"textform":"Persönlicher Brief"}',
      answer({ erfuellt: false, zitat: 'Erste Zeile' }),
      answer({ erfuellt: true, zitat: 'Erste Zeile' }),
    );
    const result = await reviewContent(input({ form: true, formName: 'Grußkarte' }), ask, signal());
    expect(ask).toHaveBeenCalledTimes(4);
    expect(result).toEqual({
      ok: true,
      comments: [{ pageId: 'p1', line: 1, kind: 'form', text: 'Ort und Datum fehlen' }],
      questions: 3,
      checkedAs: 'Persönlicher Brief',
    });
  });

  it('names the catalogue form in the prompt of a mapped name', async () => {
    const ask = askWith(answer({ erfuellt: true, zitat: 'Erste Zeile' }));
    await reviewContent(input({ form: true, formName: 'Brief an Oma' }), ask, signal());
    const [request] = ask.mock.calls[0] ?? [];
    expect(request?.messages[0]?.content).toContain('Verlangte Textform: Persönlicher Brief.');
  });

  it('maps a known pattern without asking the model and names the form it checked', async () => {
    const ask = askWith(answer({ erfuellt: true, zitat: 'Erste Zeile' }));
    const result = await reviewContent(
      input({ form: true, formName: 'Brief an Oma' }),
      ask,
      signal(),
    );
    expect(ask).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      ok: true,
      comments: [],
      questions: 3,
      checkedAs: 'Persönlicher Brief',
    });
  });

  it('names no form when the given name is the catalogue name', async () => {
    const result = await reviewContent(
      input({ form: true, formName: 'persönlicher brief' }),
      askWith(answer({ erfuellt: true, zitat: 'Erste Zeile' })),
      signal(),
    );
    expect(result).toEqual({ ok: true, comments: [], questions: 3 });
  });

  it('reports nothing for met questions', async () => {
    const result = await reviewContent(
      input(contentScope),
      askWith(answer({ erfuellt: true, zitat: 'Erste Zeile' })),
      signal(),
    );
    expect(result).toEqual({ ok: true, comments: [], questions: 2 });
  });

  it('drops comments with the same text', async () => {
    const result = await reviewContent(
      input({ form: true, formName: 'Brief' }),
      askWith(answer({ erfuellt: false, zitat: 'Erste Zeile' })),
      signal(),
    );
    expect(result.ok && result.comments.map((comment) => comment.text)).toEqual([
      'Ort und Datum fehlen',
      'Anrede fehlt',
      'Grußformel fehlt',
    ]);
    const same = await reviewContent(
      input(contentScope),
      askWith(answer({ erfuellt: false, zitat: 'Erste Zeile', kommentar: 'Thema verfehlt' })),
      signal(),
    );
    expect(same.ok && same.comments).toHaveLength(1);
  });

  it('keeps only one content comment', async () => {
    const result = await reviewContent(
      input(contentScope),
      askWith(
        answer({ erfuellt: false, zitat: 'Erste Zeile', kommentar: 'Thema verfehlt' }),
        answer({ erfuellt: false, zitat: 'Dritte Zeile', kommentar: 'Vorgabe fehlt' }),
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
      askWith(
        'kaputt',
        answer({ erfuellt: false, zitat: 'Dritte Zeile', kommentar: 'Vorgabe fehlt' }),
      ),
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
      askWith(answer({ erfuellt: false, zitat: 'Erste Zeile', kommentar: 'x' })),
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
