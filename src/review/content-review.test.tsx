// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import type { ContentComment, ContentResult } from '../content-form/review.ts';
import { createFakeCorrector } from '../correction/fake-corrector.ts';
import { DEFAULT_SCOPE, type CorrectionScope } from '../correction/scope.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import {
  buildArbeitModel,
  contentReview,
  type CommentEntry,
  type ContentReviewModel,
} from './arbeit-model.ts';
import { ArbeitSide, type ArbeitSideProps } from './ArbeitSide.tsx';
import type { CommentStatus } from './review-flow.ts';
import { setupReview } from './test-support.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const CONTENT: CorrectionScope = {
  ...DEFAULT_SCOPE,
  content: true,
  assignment: 'Schreibe über deinen Tag im Schwimmbad.',
};

const MISSING_TASK: ContentComment = {
  pageId: 'a',
  line: 2,
  kind: 'content',
  text: 'Aufgabe nicht erfüllt',
};

const NO_GREETING: ContentComment = {
  pageId: 'b',
  line: 1,
  kind: 'form',
  text: 'Anrede fehlt',
};

async function reviewed(comments: readonly ContentComment[], blankLast = false) {
  const setup = setupReview(['a', 'b']);
  const answer: ContentResult = { ok: true, comments, questions: 2 };
  setup.flow.setReviewer(
    createFakeCorrector(
      (lines) => lines.join('\n'),
      () => answer,
    ),
  );
  if (blankLast) setup.h.transcripts.b = { ok: true, lines: ['', ''] };
  const arbeit: Arbeit = { id: 'x', name: 'Aufsatz Ada', pages: setup.pages };
  await setup.flow.start(setup.pages, DEUTSCH, CONTENT, [{ id: 'x', pageIds: ['a', 'b'] }]);
  const model = () =>
    buildArbeitModel(arbeit, setup.flow.getState(), setup.runner.getState().entries);
  return { ...setup, arbeit, model };
}

describe('the content review in the Arbeit model', () => {
  it('keeps a mark and drops the margin note it covers on the same line', async () => {
    const tense: ContentComment = { pageId: 'a', line: 1, kind: 'form', text: 'Präsens verwenden' };
    const { arbeit, flow, runner } = await reviewed([tense, NO_GREETING]);
    const state = flow.getState();
    const page = state.pages['a'];
    const result = page?.result;
    if (page === undefined || result == null) throw new Error('page a not corrected');
    const [first, ...rest] = result.transcript.lines;
    if (first === undefined) throw new Error('page a has no lines');
    const verb = first.text.split(' ')[0] ?? '';
    const marked = {
      ...first,
      marks: [
        { kind: 'error' as const, type: 'T', original: verb, correction: `${verb}x`, offset: 0 },
      ],
    };
    const covered = {
      ...state,
      pages: {
        ...state.pages,
        a: { ...page, result: { ...result, transcript: { lines: [marked, ...rest] } } },
      },
    };
    const model = buildArbeitModel(arbeit, covered, runner.getState().entries);
    expect(model.content?.comments.map((comment) => comment.coveredBy)).toEqual(['T', null]);
    expect(model.pages.map((item) => item.correction?.comments)).toEqual([
      [],
      [{ line: 1, text: 'Anrede fehlt' }],
    ]);
    expect(model.content?.summary).toBe('Form: Präsens verwenden, Anrede fehlt.');
    expect(model.pages[0]?.correction?.errors).toBe(result.statistics.errors);
  });

  it('numbers the comments by page and line within the Arbeit', async () => {
    const { model } = await reviewed([MISSING_TASK, NO_GREETING]);

    expect(model().content).toEqual({
      status: 'done',
      message: null,
      summary: 'Inhalt: Aufgabe nicht erfüllt. Form: Anrede fehlt.',
      comments: [
        {
          index: 0,
          status: 'open',
          kind: 'content',
          text: 'Aufgabe nicht erfüllt',
          page: 1,
          line: 2,
          coveredBy: null,
        },
        {
          index: 1,
          status: 'open',
          kind: 'form',
          text: 'Anrede fehlt',
          page: 2,
          line: 1,
          coveredBy: null,
        },
      ],
    });
    expect(model().pages.map((page) => page.correction?.comments)).toEqual([
      [{ line: 2, text: 'Aufgabe nicht erfüllt' }],
      [{ line: 1, text: 'Anrede fehlt' }],
    ]);
  });

  it('puts the summary only on the last corrected page', async () => {
    const { model } = await reviewed([MISSING_TASK, NO_GREETING]);
    expect(model().pages.map((page) => page.correction?.summary)).toEqual([
      null,
      'Inhalt: Aufgabe nicht erfüllt. Form: Anrede fehlt.',
    ]);
  });

  it('moves the summary to the last page that carries a correction when the final page is blank', async () => {
    const { model } = await reviewed([MISSING_TASK], true);

    expect(model().pages.map((page) => page.empty)).toEqual([false, true]);
    expect(model().pages.map((page) => page.correction?.summary ?? null)).toEqual([
      'Inhalt: Aufgabe nicht erfüllt.',
      null,
    ]);
  });

  it('leaves dismissed comments out of the page notes and the summary but keeps them listed', async () => {
    const { flow, model } = await reviewed([MISSING_TASK, NO_GREETING]);
    flow.setComment('x', 1, 'dismissed');

    expect(model().content?.summary).toBe('Inhalt: Aufgabe nicht erfüllt.');
    expect(model().content?.comments.map((comment) => comment.status)).toEqual([
      'open',
      'dismissed',
    ]);
    expect(model().pages.map((page) => page.correction?.comments.length)).toEqual([1, 0]);

    flow.setComment('x', 0, 'dismissed');
    expect(model().content?.summary).toBeNull();
    expect(model().pages.map((page) => page.correction?.summary)).toEqual([null, null]);
  });

  it('reports a review without findings as done with no summary', async () => {
    const { model } = await reviewed([]);
    expect(model().content).toEqual({ status: 'done', comments: [], summary: null, message: null });
    expect(model().pages.every((page) => page.correction?.summary === null)).toBe(true);
  });

  it('drops comments that point to a page outside the Arbeit', async () => {
    const { model } = await reviewed([{ ...MISSING_TASK, pageId: 'elsewhere' }, NO_GREETING]);

    expect(model().content?.comments.map((comment) => comment.index)).toEqual([1]);
    expect(model().content?.summary).toBe('Form: Anrede fehlt.');
  });

  it('shows no review once a page was read again without reviewing the work', async () => {
    const { h, pages, flow, model } = await reviewed([MISSING_TASK, NO_GREETING]);
    expect(model().content).not.toBeNull();

    h.transcripts.b = { ok: true, lines: ['Wir gingen nach Hause.'] };
    const [, second] = pages;
    if (second === undefined) throw new Error('missing page');
    await flow.retry(second, { recognize: true, scope: DEFAULT_SCOPE });

    expect(flow.getState().works.x?.status).toBe('done');
    expect(model().content).toBeNull();
    expect(model().pages.map((page) => page.correction?.comments)).toEqual([[], []]);
    expect(model().pages.map((page) => page.correction?.summary)).toEqual([null, null]);
  });

  it('shows no review when the Arbeit was never reviewed or the flow has no such work', async () => {
    const { arbeit, flow } = await reviewed([MISSING_TASK]);
    expect(contentReview({ ...arbeit, id: 'other' }, flow.getState())).toBeNull();
  });

  it('shows no review while the Arbeit has not been corrected at all', async () => {
    const { arbeit, flow, runner } = await reviewed([MISSING_TASK]);
    const state = { ...flow.getState(), pages: {} };
    expect(buildArbeitModel(arbeit, state, runner.getState().entries).content).toBeNull();
  });

  it('carries the failure message of a review that could not run', async () => {
    const setup = setupReview(['a', 'b']);
    setup.flow.setReviewer(
      createFakeCorrector(
        (lines) => lines.join('\n'),
        (): ContentResult => ({
          ok: false,
          error: { kind: 'failed', message: 'Zeitüberschreitung' },
        }),
      ),
    );
    const arbeit: Arbeit = { id: 'x', name: 'Aufsatz Ada', pages: setup.pages };
    await setup.flow.start(setup.pages, DEUTSCH, CONTENT, [{ id: 'x', pageIds: ['a', 'b'] }]);

    expect(contentReview(arbeit, setup.flow.getState())).toEqual({
      status: 'failed',
      comments: [],
      summary: null,
      message: 'Der Text konnte nicht korrigiert werden (Zeitüberschreitung).',
    });
  });
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function entry(index: number, overrides: Partial<CommentEntry> = {}): CommentEntry {
  return {
    index,
    status: 'open',
    kind: 'content',
    text: 'Thema verfehlt',
    page: 1,
    line: 3,
    coveredBy: null,
    ...overrides,
  };
}

function content(overrides: Partial<ContentReviewModel> = {}): ContentReviewModel {
  const comments = overrides.comments ?? [];
  return { status: 'done', comments, summary: null, message: null, ...overrides };
}

const noop = () => undefined;

type CommentHandler = NonNullable<ArbeitSideProps['onComment']>;

function sideProps(overrides: Partial<ArbeitSideProps>): ArbeitSideProps {
  return {
    pages: [],
    corrected: true,
    profile: DEUTSCH,
    editing: null,
    editLocked: false,
    activeMark: null,
    activeHint: null,
    selectedHint: null,
    openGroups: new Set(),
    onToggleGroup: noop,
    onMarkHover: noop,
    onMarkSelect: noop,
    onHintHover: noop,
    onHintReveal: noop,
    onHint: noop,
    onEdit: noop,
    onEditDone: noop,
    ...overrides,
  };
}

function renderSide(overrides: Partial<ArbeitSideProps>) {
  act(() => root.render(<ArbeitSide {...sideProps(overrides)} />));
}

const all = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const text = () => container.textContent;

function button(name: string): HTMLButtonElement {
  const found = all('button').find((candidate) => candidate.getAttribute('aria-label') === name);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no button ${name}`);
  return found;
}

describe('the content column of an Arbeit', () => {
  it('says there is nothing to note when the review is done without comments', () => {
    renderSide({ content: content(), onComment: vi.fn<CommentHandler>() });

    expect(all('.side-empty').map((element) => element.textContent)).toEqual([
      'Inhalt und Form: keine Auffälligkeiten',
    ]);
    expect(container.querySelector('#side-content')).toBeNull();
    expect(all('button')).toEqual([]);
  });

  it('lists each comment with its page and line and counts the open ones', () => {
    renderSide({
      content: content({
        comments: [
          entry(0),
          entry(1, { page: 2, line: 7, kind: 'form', text: 'Anrede fehlt' }),
          entry(2, { text: 'Zu kurz', status: 'dismissed' }),
        ],
        summary: 'Inhalt: Thema verfehlt. Form: Anrede fehlt.',
      }),
      onComment: vi.fn<CommentHandler>(),
    });

    expect(all('.side-comment-place').map((element) => element.textContent)).toEqual([
      'S. 1, Z. 3',
      'S. 2, Z. 7',
      'S. 1, Z. 3',
    ]);
    expect(all('.side-comment-text').map((element) => element.textContent)).toEqual([
      'S. 1, Z. 3 Thema verfehlt',
      'S. 2, Z. 7 Anrede fehlt',
      'S. 1, Z. 3 Zu kurz',
    ]);
    expect(container.querySelector('#side-content')?.textContent).toBe('Inhalt und Form');
    expect(container.querySelector('#side-content + .side-page-figure')?.textContent).toBe('2');
    expect(container.querySelector('.side-summary')?.textContent).toBe(
      'Inhalt: Thema verfehlt. Form: Anrede fehlt.',
    );
    expect(all('li').map((element) => element.dataset['status'])).toEqual([
      'open',
      'open',
      'dismissed',
    ]);
  });

  it('reports the dismissal to the caller and offers to take it back', () => {
    const onComment = vi.fn<(index: number, status: CommentStatus) => void>();
    function Stateful() {
      const [status, setStatus] = useState<CommentStatus>('open');
      return (
        <ArbeitSide
          {...sideProps({
            content: content({ comments: [entry(4, { status })] }),
            onComment: (index, next) => {
              onComment(index, next);
              setStatus(next);
            },
          })}
        />
      );
    }
    act(() => root.render(<Stateful />));
    expect(text()).not.toContain('verworfen');
    expect(all('button').map((element) => element.textContent)).toEqual(['Verwerfen']);

    act(() => button('Verwerfen: Thema verfehlt').click());
    expect(onComment).toHaveBeenLastCalledWith(4, 'dismissed');
    expect(text()).toContain('verworfen');
    expect(container.querySelector('#side-content + .side-page-figure')?.textContent).toBe('0');
    expect(all('button').map((element) => element.textContent)).toEqual(['Rückgängig']);

    act(() => button('Rückgängig: Thema verfehlt').click());
    expect(onComment).toHaveBeenLastCalledWith(4, 'open');
    expect(onComment).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain('verworfen');
    expect(container.querySelector('#side-content + .side-page-figure')?.textContent).toBe('1');
  });

  it.each([
    ['reviewing', 'wird geprüft …'],
    ['cancelled', 'abgebrochen'],
  ] as const)('names a review that is %s instead of counting', (status, figure) => {
    renderSide({ content: content({ status }), onComment: vi.fn<CommentHandler>() });
    expect(container.querySelector('#side-content + .side-page-figure')?.textContent).toBe(figure);
    expect(text()).not.toContain('keine Auffälligkeiten');
  });

  it('shows why a review failed and that nothing was checked', () => {
    renderSide({
      content: content({
        status: 'failed',
        message: 'Der Text konnte nicht korrigiert werden (x).',
      }),
      onComment: vi.fn<CommentHandler>(),
    });
    expect(container.querySelector('#side-content + .side-page-figure')?.textContent).toBe(
      'nicht geprüft',
    );
    expect(container.querySelector('.side-empty')?.textContent).toBe(
      'Der Text konnte nicht korrigiert werden (x).',
    );
  });

  it('stays out of the column before the correction and without a content model', () => {
    renderSide({
      content: content({ comments: [entry(0)] }),
      onComment: vi.fn<CommentHandler>(),
      corrected: false,
    });
    expect(container.querySelector('.side-content')).toBeNull();

    renderSide({ content: null, onComment: vi.fn<CommentHandler>() });
    expect(container.querySelector('.side-content')).toBeNull();
    expect(text()).not.toContain('Inhalt und Form');

    renderSide({ content: content({ comments: [entry(0)] }) });
    expect(container.querySelector('.side-content')).toBeNull();
  });
});
