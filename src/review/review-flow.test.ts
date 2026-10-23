// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEUTSCH, ENGLISCH } from '../annotations/profile.ts';
import {
  CORRECTOR_MISSING,
  IMAGE_FAILED,
  LAYOUT_FAILED,
  NOT_RERECOGNIZED,
  REVIEWER_MISSING,
  type ContentReviewLog,
  type ReviewFlow,
  type ReviewWork,
} from './review-flow.ts';
import type { ContentComment, ContentResult } from '../content-form/review.ts';
import type { Corrector } from '../correction/corrector.ts';
import { createFakeCorrector } from '../correction/fake-corrector.ts';
import { DEFAULT_SCOPE, type CorrectionScope } from '../correction/scope.ts';
import { requestedTypes } from './summary.ts';
import { deferred, readingOf, setupReview, tick, waitFor } from './test-support.ts';

describe('createReviewFlow', () => {
  it('finishes every transcription before the first correction', async () => {
    const { pages, h, flow } = setupReview();
    await flow.start(pages, DEUTSCH);

    const lastTranscription = Math.max(
      ...h.log.flatMap((entry, index) => (entry.startsWith('T:') ? [index] : [])),
    );
    const firstCorrection = h.log.findIndex((entry) => entry.startsWith('C:'));
    expect(h.log.filter((entry) => entry.startsWith('T:'))).toHaveLength(3);
    expect(h.log.filter((entry) => entry.startsWith('C:'))).toHaveLength(3);
    expect(firstCorrection).toBeGreaterThan(lastTranscription);
    expect(flow.getState().outcome).toBe('finished');
    expect(flow.getState().run).toBeNull();
  });

  it('stores marks with line positions, statistics and the page image', async () => {
    const { pages, flow } = setupReview(['a']);
    await flow.start(pages, DEUTSCH);

    const result = flow.getState().pages.a;
    expect(result?.status).toBe('done');
    expect(result?.image).toMatchObject({ width: 1000, height: 1400 });
    expect(result?.result?.preview).toBe(false);
    const line = result?.result?.transcript.lines[0];
    expect(line?.bbox).toEqual({ x: 100, y: 100, width: 700, height: 40 });
    expect(line?.marks).toEqual([
      expect.objectContaining({ type: 'R', original: 'Schwimbad', correction: 'Schwimmbad' }),
    ]);
    expect(result?.result?.statistics).toMatchObject({ words: 7, errors: 1 });
    expect(result?.result?.unplacedLines).toEqual([]);
  });

  it('shows marks on uncertainly read words as hints that only count once accepted', async () => {
    const { pages, h, flow } = setupReview(['a']);
    h.transcripts.a = {
      ok: true,
      lines: ['Ich war im Schwimbad.', 'Es war schön.'],
      reading: readingOf(['Ich war im Schwimbad.', 'Es war schön.'], { 'Schwimbad.': 0.4 }),
    };
    await flow.start(pages, DEUTSCH);

    const before = flow.getState().pages.a?.result;
    expect(before?.transcript.lines[0]?.marks).toEqual([]);
    expect(before?.statistics).toMatchObject({ words: 7, errors: 0 });
    expect(before?.hints).toEqual([
      expect.objectContaining({
        line: 1,
        status: 'open',
        confidence: 0.4,
        mark: expect.objectContaining({ original: 'Schwimbad', correction: 'Schwimmbad' }),
      }),
    ]);

    flow.setHint('a', 0, 'accepted');
    const accepted = flow.getState().pages.a?.result;
    expect(accepted?.hints[0]?.status).toBe('accepted');
    expect(accepted?.transcript.lines[0]?.marks).toEqual([
      expect.objectContaining({ original: 'Schwimbad', correction: 'Schwimmbad' }),
    ]);
    expect(accepted?.statistics).toMatchObject({ errors: 1, errorsByType: { R: 1 } });

    flow.setHint('a', 0, 'dismissed');
    const dismissed = flow.getState().pages.a?.result;
    expect(dismissed?.hints[0]?.status).toBe('dismissed');
    expect(dismissed?.transcript.lines[0]?.marks).toEqual([]);
    expect(dismissed?.statistics.errors).toBe(0);

    flow.setHint('a', 0, 'dismissed');
    flow.setHint('a', 7, 'open');
    flow.setHint('missing', 0, 'open');
    expect(flow.getState().pages.a?.result).toBe(dismissed);
  });

  it('treats an edited line as certain and keeps the confidence of the other lines', async () => {
    const { pages, h, runner, flow } = setupReview(['a']);
    const read = ['Die Wält ist rund.', 'Wir waren im Schwimbad.', 'Die Welt ist groß.'];
    h.transcripts.a = {
      ok: true,
      lines: read,
      reading: readingOf(read, { Wält: 0.4, 'Schwimbad.': 0.3, Welt: 0.6 }),
    };
    runner.start();
    await waitFor(() => runner.getState().batch === null);
    runner.edit('a', 'Die Welt ist rund.\nWir waren im Schwimbad.\nDie Welt ist groß.');
    h.corrections['Die Welt ist rund.'] = {
      ok: true,
      correctedText: 'Die Welt ist Rund.\nWir waren im Schwimmbad.\nDie Welt ist groß.',
    };
    await flow.start(pages, DEUTSCH);

    const result = flow.getState().pages.a?.result;
    expect(result?.transcript.lines.map((line) => line.marks.map((mark) => mark.original))).toEqual(
      [['rund'], [], []],
    );
    expect(result?.hints.map((hint) => [hint.line, hint.mark.original])).toEqual([
      [2, 'Schwimbad'],
    ]);
  });

  it('forgets the reading confidence when the edit changes the number of lines', async () => {
    const { pages, h, runner, flow } = setupReview(['a']);
    const read = ['Ich war im Schwimbad.', 'Es war schön.'];
    h.transcripts.a = { ok: true, lines: read, reading: readingOf(read, { 'Schwimbad.': 0.3 }) };
    runner.start();
    await waitFor(() => runner.getState().batch === null);
    runner.edit('a', 'Ich war im Schwimbad.');
    expect(runner.getState().entries.a?.reading).toBeNull();
    h.corrections['Ich war im Schwimbad.'] = { ok: true, correctedText: 'Ich war im Schwimmbad.' };
    await flow.start(pages, DEUTSCH);
    expect(flow.getState().pages.a?.result).toMatchObject({ hints: [], statistics: { errors: 1 } });
  });

  it('keeps every mark red when the transcript carries no reading confidence', async () => {
    const { pages, flow } = setupReview(['a']);
    await flow.start(pages, DEUTSCH);
    const result = flow.getState().pages.a?.result;
    expect(result?.hints).toEqual([]);
    expect(result?.statistics.errors).toBe(1);
  });

  it('reuses transcripts from the word count', async () => {
    const { pages, h, runner, flow } = setupReview();
    runner.start();
    await waitFor(() => runner.getState().batch === null);
    h.log.length = 0;

    await flow.start(pages, DEUTSCH);

    expect(h.log.filter((entry) => entry.startsWith('T:'))).toEqual([]);
    expect(Object.values(flow.getState().pages).map((p) => p.status)).toEqual([
      'done',
      'done',
      'done',
    ]);
  });

  it('marks blank pages as empty and does not correct them', async () => {
    const { pages, h, flow } = setupReview(['a', 'b']);
    h.transcripts.b = { ok: true, lines: ['', '   '] };
    await flow.start(pages, DEUTSCH);

    expect(flow.getState().pages.b?.status).toBe('empty');
    expect(h.log).not.toContain('C:');
    expect(h.log.filter((entry) => entry.startsWith('C:'))).toHaveLength(1);
  });

  it('keeps unreadable pages out of the correction and names the reason', async () => {
    const { pages, h, flow } = setupReview();
    h.transcripts.b = { ok: false, error: { kind: 'failed', message: 'Bild leer' } };
    await flow.start(pages, DEUTSCH);

    const b = flow.getState().pages.b;
    expect(b?.status).toBe('unreadable');
    expect(b?.message).toBe('Die Seite konnte nicht erkannt werden (Bild leer).');
    expect(h.log).not.toContain('C:Wir gingen heim.');
    expect(flow.getState().pages.a?.status).toBe('done');
    expect(flow.getState().pages.c?.status).toBe('done');
  });

  it('reports a failed correction per page and retries only that page', async () => {
    const { pages, h, flow } = setupReview();
    h.corrections['Wir gingen heim.'] = {
      ok: false,
      error: { kind: 'failed', message: 'Zeitüberschreitung' },
    };
    await flow.start(pages, DEUTSCH);

    expect(flow.getState().pages.b).toMatchObject({
      status: 'failed',
      message: 'Der Text konnte nicht korrigiert werden (Zeitüberschreitung).',
    });
    expect(flow.getState().pages.c?.status).toBe('done');

    delete h.corrections['Wir gingen heim.'];
    h.log.length = 0;
    const [, second] = pages;
    if (second === undefined) throw new Error('missing page');
    await flow.retry(second);

    expect(flow.getState().pages.b?.status).toBe('done');
    expect(h.log).toEqual(['C:Wir gingen heim.']);
  });

  it('retries an unreadable page through recognition, layout and correction', async () => {
    const { pages, h, flow } = setupReview(['a', 'b']);
    h.transcripts.b = { ok: false, error: { kind: 'failed', message: 'Bild leer' } };
    await flow.start(pages, DEUTSCH);
    h.transcripts.b = { ok: true, lines: ['Wir gingen heim.'] };
    h.log.length = 0;

    const [, second] = pages;
    if (second === undefined) throw new Error('missing page');
    await flow.retry(second);

    expect(h.log).toEqual(['T:b', 'L:b', 'C:Wir gingen heim.']);
    expect(flow.getState().pages.b?.status).toBe('done');
  });

  it('recognises a corrected page again on request and corrects the new text', async () => {
    const { pages, h, flow, runner } = setupReview(['a', 'b']);
    await flow.start(pages, DEUTSCH);
    h.transcripts.b = { ok: true, lines: ['Wir gingen nach Hause.'] };
    h.log.length = 0;

    const [, second] = pages;
    if (second === undefined) throw new Error('missing page');
    await flow.retry(second, { recognize: true });

    expect(h.log).toEqual(['T:b', 'L:b', 'C:Wir gingen nach Hause.']);
    expect(runner.getState().entries.b?.text).toBe('Wir gingen nach Hause.');
    expect(flow.getState().pages.b?.status).toBe('done');
  });

  it('corrects a page again without recognising it again', async () => {
    const { pages, h, flow } = setupReview(['a']);
    await flow.start(pages, DEUTSCH);
    h.log.length = 0;

    const [first] = pages;
    if (first === undefined) throw new Error('missing page');
    await flow.retry(first);

    expect(h.log).toEqual(['C:Ich war im Schwimbad.']);
    expect(flow.getState().pages.a?.status).toBe('done');
  });

  it('marks only the requested kinds and corrects again with the current scope', async () => {
    const { pages, flow } = setupReview(['a', 'b']);
    const grammarOnly = { ...DEFAULT_SCOPE, spelling: false };
    await flow.start(pages, DEUTSCH, grammarOnly);
    const types = () =>
      flow.getState().pages.a?.result?.transcript.lines[0]?.marks.map((m) => m.type);
    expect(types()).toEqual([]);
    expect(flow.getState().pages.a?.result?.requested).toEqual(['G', 'A', 'Sb', 'T', 'Bz', 'W']);
    const arbeiten = [{ id: 'x', name: 'Aufsatz', pages }];
    expect(requestedTypes(arbeiten, flow.getState())).toEqual(['G', 'A', 'Sb', 'T', 'Bz', 'W']);

    const [first] = pages;
    if (first === undefined) throw new Error('missing page');
    await flow.retry(first, { scope: { ...DEFAULT_SCOPE, grammar: false } });
    expect(types()).toEqual(['R']);
    expect(flow.getState().pages.b?.result?.requested).toEqual(['G', 'A', 'Sb', 'T', 'Bz', 'W']);
    expect(requestedTypes(arbeiten, flow.getState())).toEqual(DEUTSCH.allowedTypes);
    expect(requestedTypes(arbeiten.slice(0, 0), flow.getState())).toEqual(DEUTSCH.allowedTypes);
  });

  it('cancels during recognition without correcting anything', async () => {
    const { pages, h, flow } = setupReview();
    const gate = deferred();
    h.transcribeGate = gate.promise;
    const running = flow.start(pages, DEUTSCH);
    await waitFor(() => h.log.includes('T:a'));
    expect(flow.getState().run?.phase).toBe('transcribing');
    expect(flow.getState().pages.a?.status).toBe('transcribing');

    flow.cancel();
    await running;

    expect(flow.getState().outcome).toBe('cancelled');
    expect(Object.values(flow.getState().pages).map((p) => p.status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
    expect(h.log.some((entry) => entry.startsWith('C:'))).toBe(false);
  });

  it('retries only the page that was still waiting for recognition when cancelled', async () => {
    const { pages, h, flow } = setupReview();
    const gate = deferred();
    h.transcribeGate = gate.promise;
    const running = flow.start(pages, DEUTSCH);
    await waitFor(() => h.log.includes('T:a'));
    flow.cancel();
    await running;
    h.transcribeGate = null;
    h.log.length = 0;

    const [, second] = pages;
    if (second === undefined) throw new Error('missing page');
    await flow.retry(second);

    expect(h.log).toEqual(['T:b', 'L:b', 'C:Wir gingen heim.']);
    expect(flow.getState().pages.b?.status).toBe('done');
    expect(flow.getState().pages.a?.status).toBe('cancelled');
    expect(flow.getState().pages.c?.status).toBe('cancelled');
  });

  it('cancels while locating lines', async () => {
    const { pages, h, flow } = setupReview(['a', 'b']);
    const gate = deferred();
    h.locateGate = gate.promise;
    const running = flow.start(pages, DEUTSCH);
    await waitFor(() => h.log.includes('L:a'));
    expect(flow.getState().run?.phase).toBe('locating');

    flow.cancel();
    await tick();
    expect(flow.getState().stopping).toBe(true);
    gate.resolve();
    await running;

    expect(flow.getState().stopping).toBe(false);
    expect(flow.getState().pages.a?.status).toBe('cancelled');
    expect(flow.getState().pages.b?.status).toBe('cancelled');
    expect(h.log.some((entry) => entry.startsWith('C:'))).toBe(false);
  });

  it('cancels during correction and later continues with the unfinished pages', async () => {
    const { pages, h, flow } = setupReview(['a', 'b']);
    const gate = deferred();
    h.correctGate = gate.promise;
    const running = flow.start(pages, DEUTSCH);
    await waitFor(() => h.log.includes('C:Ich war im Schwimbad.'));
    expect(flow.getState().run?.phase).toBe('correcting');

    flow.cancel();
    await running;
    expect(flow.getState().pages.a?.status).toBe('cancelled');
    expect(flow.getState().pages.b?.status).toBe('cancelled');
    expect(h.log).not.toContain('C:Wir gingen heim.');

    h.correctGate = null;
    h.log.length = 0;
    await flow.start(pages, DEUTSCH);
    expect(h.log).toEqual(['C:Ich war im Schwimbad.', 'C:Wir gingen heim.']);
    expect(flow.getState().pages.b?.status).toBe('done');
  });

  it('skips pages that are already corrected with the same profile', async () => {
    const { pages, h, flow } = setupReview(['a']);
    await flow.start(pages, DEUTSCH);
    h.log.length = 0;
    await flow.start(pages, DEUTSCH);
    expect(h.log).toEqual([]);

    await flow.start(pages, ENGLISCH);
    expect(h.log).toEqual(['L:a', 'C:Ich war im Schwimbad.']);
    expect(flow.getState().profile?.id).toBe('englisch');
  });

  it('fails every page clearly when no corrector is set', async () => {
    const { pages, flow } = setupReview(['a']);
    flow.setCorrector(null);
    await flow.start(pages, DEUTSCH);
    expect(flow.getState().pages.a).toMatchObject({ status: 'failed', message: CORRECTOR_MISSING });
  });

  it('still corrects a page whose lines were not found', async () => {
    const { pages, h, flow } = setupReview(['a']);
    h.layoutFails = true;
    await flow.start(pages, DEUTSCH);

    const result = flow.getState().pages.a?.result;
    expect(result?.transcript.lines[0]?.bbox).toBeUndefined();
    expect(result?.unplacedLines).toEqual([1]);
  });

  it('keeps the margin lines of the located page', async () => {
    const { pages, h, flow } = setupReview(['a']);
    const points = [
      { x: 900, y: 0 },
      { x: 905, y: 1400 },
    ];
    h.ruling = {
      kind: 'lined',
      horizontal: [],
      vertical: [],
      pitch: 40,
      columnPitch: 0,
      angleDegrees: 0,
      margins: { left: null, right: { points } },
    };
    await flow.start(pages, DEUTSCH);
    expect(flow.getState().pages.a?.margins).toEqual({ left: null, right: points });
  });

  it('drops pages that left the import', async () => {
    const { pages, flow } = setupReview(['a', 'b']);
    await flow.start(pages, DEUTSCH);
    flow.prune(new Set(['a']));
    expect(Object.keys(flow.getState().pages)).toEqual(['a']);
  });

  it('treats a page whose recognition failed after rotating as unreadable', async () => {
    const { pages, h, runner, flow } = setupReview(['a', 'b']);
    await flow.start(pages, DEUTSCH);
    const rotated = pages.map((p) => (p.id === 'b' ? { ...p, rotation: 90 as const } : p));
    runner.setPages(rotated);
    h.transcripts.b = { ok: false, error: { kind: 'failed', message: 'Bild leer' } };
    h.log.length = 0;

    await flow.start(rotated, DEUTSCH);

    expect(runner.getState().entries.b).toMatchObject({ hasTranscript: true, rotation: 0 });
    expect(flow.getState().pages.b).toMatchObject({
      status: 'unreadable',
      message: 'Die Seite konnte nicht erkannt werden (Bild leer).',
      result: null,
    });
    expect(h.log).toEqual(['T:b']);
  });

  it('names a rotated page that was not recognized again', async () => {
    const { pages, runner, flow } = setupReview(['a']);
    await flow.start(pages, DEUTSCH);
    runner.edit('a', 'Ich war im Schwimbad.\nEs war schön.');
    const rotated = pages.map((p) => ({ ...p, rotation: 180 as const }));
    runner.setPages(rotated);

    await flow.start(rotated, DEUTSCH);

    expect(flow.getState().pages.a).toMatchObject({
      status: 'unreadable',
      message: NOT_RERECOGNIZED,
    });
  });

  it('recognizes only the retried page again after rotating', async () => {
    const { pages, h, runner, flow } = setupReview(['a', 'b']);
    await flow.start(pages, DEUTSCH);
    runner.edit('a', 'Ich war im Schwimbad.\nEs war schön.');
    runner.edit('b', 'Wir gingen heim.');
    const rotated = pages.map((p) => ({ ...p, rotation: 90 as const }));
    runner.setPages(rotated);
    h.log.length = 0;

    const [, second] = rotated;
    if (second === undefined) throw new Error('missing page');
    await flow.retry(second);

    expect(h.log).toEqual(['T:b', 'L:b', 'C:Wir gingen heim.']);
    expect(flow.getState().pages.b).toMatchObject({ status: 'done', rotation: 90 });
  });

  it('keeps correcting when the page image or the line search fails, with a visible note', async () => {
    const { pages, h, flow } = setupReview(['a', 'b']);
    h.imageFails = true;
    const [first, second] = pages;
    if (first === undefined || second === undefined) throw new Error('missing pages');
    await flow.start([first], DEUTSCH);
    h.imageFails = false;
    h.layoutFails = true;
    await flow.start([first, second], DEUTSCH);

    expect(flow.getState().pages.a).toMatchObject({
      status: 'done',
      image: null,
      warning: { text: IMAGE_FAILED, detail: 'Bild kaputt' },
    });
    expect(flow.getState().pages.b).toMatchObject({
      status: 'done',
      warning: { text: LAYOUT_FAILED, detail: 'kaputt' },
    });
  });

  it('marks results from the preview corrector', async () => {
    const { pages, corrector, flow } = setupReview(['a']);
    flow.setCorrector(corrector, true);
    await flow.start(pages, DEUTSCH);
    expect(flow.getState().pages.a?.result?.preview).toBe(true);
  });

  it('reports an unexpected correction failure in German and keeps the details', async () => {
    const { pages, h, flow } = setupReview(['a']);
    h.correctThrows = true;
    await flow.start(pages, DEUTSCH);
    expect(flow.getState().pages.a).toMatchObject({
      status: 'failed',
      message: 'Der Text konnte nicht korrigiert werden (unerwarteter Fehler).',
      detail: 'Speicher voll',
    });
  });

  it('waits for a running correction to end before it can start again', async () => {
    const { pages, h, flow, corrector } = setupReview(['a']);
    const gate = deferred();
    flow.setCorrector({
      async correct(lines, profile, signal) {
        h.log.push('slow');
        await gate.promise;
        return corrector.correct(lines, profile, signal);
      },
    });
    const running = flow.start(pages, DEUTSCH);
    await waitFor(() => h.log.includes('slow'));

    flow.cancel();
    await tick();
    expect(flow.getState()).toMatchObject({ stopping: true, run: { phase: 'correcting' } });
    void flow.start(pages, DEUTSCH);
    expect(h.log.filter((entry) => entry === 'slow')).toHaveLength(1);

    gate.resolve();
    await running;
    expect(flow.getState()).toMatchObject({ stopping: false, run: null, outcome: 'cancelled' });
  });
});

const ASSIGNMENT = 'Schreibe über deinen Tag im Schwimmbad.';
const CONTENT: CorrectionScope = { ...DEFAULT_SCOPE, content: true, assignment: ASSIGNMENT };
const MISSING_TASK: ContentComment = {
  pageId: 'a',
  line: 2,
  kind: 'content',
  text: 'Aufgabe nicht erfüllt',
};
const FORM_NAME: ContentComment = { pageId: 'b', line: 1, kind: 'form', text: 'Anrede fehlt' };

function contentSetup(
  ids: readonly string[] = ['a', 'b'],
  extra: Parameters<typeof setupReview>[1] = {},
) {
  const setup = setupReview(ids, extra);
  const answer: { current: ContentResult } = {
    current: { ok: true, comments: [MISSING_TASK], questions: 2 },
  };
  const fake = createFakeCorrector(
    (lines) => lines.join('\n'),
    () => answer.current,
  );
  setup.flow.setCorrector(fake);
  setup.flow.setReviewer(fake);
  const works: ReviewWork[] = [{ id: 'w', pageIds: [...ids] }];
  return { ...setup, answer, fake, works };
}

function watchRuns(flow: ReviewFlow) {
  const phases: string[] = [];
  const stages: string[] = [];
  flow.subscribe(() => {
    const run = flow.getState().run;
    if (run === null) return;
    if (phases.at(-1) !== run.phase) phases.push(run.phase);
    const key = JSON.stringify(run.stages);
    if (stages.at(-1) !== key) stages.push(key);
  });
  return { phases, stages };
}

describe('content review', () => {
  it('reviews each work after all pages are corrected and stores the comments as open', async () => {
    const { pages, fake, flow, works } = contentSetup();
    const watched = watchRuns(flow);
    await flow.start(pages, DEUTSCH, CONTENT, works);

    expect(watched.phases).toEqual(['transcribing', 'locating', 'correcting', 'reviewing']);
    expect(fake.calls).toHaveLength(2);
    expect(fake.reviews).toHaveLength(1);
    expect(fake.reviews[0]?.scope).toEqual(CONTENT);
    expect(fake.reviews[0]?.profile.id).toBe('deutsch');
    expect(fake.reviews[0]?.lines).toEqual([
      { pageId: 'a', line: 1, text: 'Ich war im Schwimbad.' },
      { pageId: 'a', line: 2, text: 'Es war schön.' },
      { pageId: 'b', line: 1, text: 'Wir gingen heim.' },
    ]);
    expect(flow.getState().works.w).toEqual({
      status: 'done',
      key: expect.any(String),
      sources: ['Ich war im Schwimbad.\nEs war schön.', 'Wir gingen heim.'],
      comments: [{ ...MISSING_TASK, status: 'open' }],
      message: null,
    });
    expect(flow.getState()).toMatchObject({ run: null, outcome: 'finished' });
  });

  it('weights the review stage only when something is to be reviewed', async () => {
    const { pages, flow, works } = contentSetup();
    const watched = watchRuns(flow);
    await flow.start(pages, DEUTSCH, DEFAULT_SCOPE, works);
    expect(watched.stages).toEqual([JSON.stringify({ pages: true, review: false })]);
    expect(flow.getState().works).toEqual({});
  });

  it('does not review again when nothing it depends on changed', async () => {
    const { pages, h, fake, flow, works } = contentSetup();
    await flow.start(pages, DEUTSCH, CONTENT, works);
    h.log.length = 0;
    await flow.start(pages, DEUTSCH, CONTENT, works);

    expect(fake.reviews).toHaveLength(1);
    expect(h.log).toEqual([]);
    expect(flow.getState().outcome).toBe('finished');
  });

  it('does not review again when the assignment only differs in surrounding whitespace', async () => {
    const { pages, fake, flow, works } = contentSetup();
    await flow.start(pages, DEUTSCH, CONTENT, works);
    await flow.start(pages, DEUTSCH, { ...CONTENT, assignment: `  ${ASSIGNMENT}\n\n` }, works);
    expect(fake.reviews).toHaveLength(1);
  });

  it.each([
    ['the assignment changes', { ...CONTENT, assignment: 'Beschreibe einen Ausflug.' }],
    ['a form is added', { ...CONTENT, form: true, formName: 'Persönlicher Brief' }],
  ])('reviews again when %s', async (_name, scope) => {
    const { pages, h, fake, flow, works } = contentSetup();
    await flow.start(pages, DEUTSCH, CONTENT, works);
    const before = flow.getState().works.w?.key;
    h.log.length = 0;
    await flow.start(pages, DEUTSCH, scope, works);

    expect(fake.reviews).toHaveLength(2);
    expect(fake.reviews[1]?.scope).toEqual(scope);
    expect(flow.getState().works.w?.key).not.toBe(before);
    expect(h.log).toEqual([]);
  });

  it('reviews again when the form name changes but ignores the form name while form is off', async () => {
    const { pages, fake, flow, works } = contentSetup();
    const form = { ...CONTENT, form: true, formName: 'Persönlicher Brief' };
    await flow.start(pages, DEUTSCH, form, works);
    await flow.start(pages, DEUTSCH, { ...form, formName: 'Bericht' }, works);
    expect(fake.reviews).toHaveLength(2);
    await flow.start(pages, DEUTSCH, { ...CONTENT, formName: 'Gedicht' }, works);
    expect(fake.reviews).toHaveLength(3);
    await flow.start(pages, DEUTSCH, { ...CONTENT, formName: 'Märchen' }, works);
    expect(fake.reviews).toHaveLength(3);
  });

  it('reviews again after the profile changed and rebuilds the work from scratch', async () => {
    const { pages, fake, flow, works } = contentSetup();
    await flow.start(pages, DEUTSCH, CONTENT, works);
    await flow.start(pages, ENGLISCH, CONTENT, works);

    expect(fake.reviews.map((input) => input.profile.id)).toEqual(['deutsch', 'englisch']);
    expect(flow.getState().works.w?.status).toBe('done');
  });

  it('runs only the review phase when every page is already corrected', async () => {
    const { pages, h, fake, flow, works } = contentSetup();
    await flow.start(pages, DEUTSCH, DEFAULT_SCOPE, works);
    h.log.length = 0;
    const watched = watchRuns(flow);

    await flow.start(pages, DEUTSCH, CONTENT, works);

    expect(h.log).toEqual([]);
    expect(watched.phases).toEqual(['reviewing']);
    expect(watched.stages).toEqual([JSON.stringify({ pages: false, review: true })]);
    expect(fake.calls).toHaveLength(2);
    expect(fake.reviews).toHaveLength(1);
    expect(flow.getState().works.w?.status).toBe('done');
    expect(flow.getState().outcome).toBe('finished');
  });

  it('reviews again when a corrected page was edited and corrects only that page', async () => {
    const { pages, h, runner, fake, flow, works } = contentSetup();
    await flow.start(pages, DEUTSCH, CONTENT, works);
    runner.edit('b', 'Wir gingen nach Hause.');
    h.log.length = 0;

    await flow.start(pages, DEUTSCH, CONTENT, works);

    expect(h.log).toEqual(['L:b']);
    expect(fake.reviews).toHaveLength(2);
    expect(fake.reviews[1]?.lines.at(-1)?.text).toBe('Wir gingen nach Hause.');
    expect(flow.getState().works.w?.sources).toEqual([
      'Ich war im Schwimbad.\nEs war schön.',
      'Wir gingen nach Hause.',
    ]);
  });

  it('reviews the work again after a retried page was recognised with a new text', async () => {
    const { pages, h, fake, flow, works } = contentSetup();
    await flow.start(pages, DEUTSCH, CONTENT, works);
    h.transcripts.b = { ok: true, lines: ['Wir gingen nach Hause.'] };
    const [, second] = pages;
    if (second === undefined) throw new Error('missing page');

    await flow.retry(second, { recognize: true });

    expect(fake.reviews).toHaveLength(2);
    expect(fake.reviews[1]?.lines.at(-1)?.text).toBe('Wir gingen nach Hause.');
  });

  it('does not review a retried page again when its text stayed the same', async () => {
    const { pages, fake, flow, works } = contentSetup();
    await flow.start(pages, DEUTSCH, CONTENT, works);
    const [first] = pages;
    if (first === undefined) throw new Error('missing page');
    await flow.retry(first);
    expect(fake.reviews).toHaveLength(1);
  });

  it('skips a work that contains an unreadable or failed page', async () => {
    const { pages, h, fake, flow, works } = contentSetup(['a', 'b', 'c']);
    h.transcripts.b = { ok: false, error: { kind: 'failed', message: 'Bild leer' } };
    flow.setCorrector({
      correct: (lines, profile, signal, scope) =>
        lines[0] === 'Der Tag war lang.'
          ? Promise.resolve({ ok: false, error: { kind: 'failed', message: 'Zeitüberschreitung' } })
          : fake.correct(lines, profile, signal, scope),
      review: (input, signal) => fake.review?.(input, signal) ?? Promise.reject(new Error('none')),
    });
    await flow.start(pages, DEUTSCH, CONTENT, works);

    expect(flow.getState().pages.b?.status).toBe('unreadable');
    expect(flow.getState().pages.c?.status).toBe('failed');
    expect(fake.reviews).toHaveLength(0);
    expect(flow.getState().works).toEqual({});
    expect(flow.getState()).toMatchObject({ run: null, outcome: 'finished' });
  });

  it('reviews a work again once the failed page is retried', async () => {
    const { pages, h, fake, flow, works } = contentSetup();
    h.transcripts.b = { ok: false, error: { kind: 'failed', message: 'Bild leer' } };
    await flow.start(pages, DEUTSCH, CONTENT, works);
    expect(fake.reviews).toHaveLength(0);

    h.transcripts.b = { ok: true, lines: ['Wir gingen heim.'] };
    const [, second] = pages;
    if (second === undefined) throw new Error('missing page');
    await flow.retry(second);

    expect(fake.reviews).toHaveLength(1);
    expect(flow.getState().works.w?.status).toBe('done');
  });

  it('reviews only the readable works and keeps blank pages as empty lines', async () => {
    const { pages, h, fake, flow } = contentSetup(['a', 'b', 'c']);
    h.transcripts.b = { ok: true, lines: ['', '  '] };
    h.transcripts.c = { ok: false, error: { kind: 'failed', message: 'Bild leer' } };
    const works: ReviewWork[] = [
      { id: 'first', pageIds: ['a', 'b'] },
      { id: 'second', pageIds: ['c'] },
    ];
    await flow.start(pages, DEUTSCH, CONTENT, works);

    expect(flow.getState().pages.b?.status).toBe('empty');
    expect(fake.reviews).toHaveLength(1);
    expect(fake.reviews[0]?.lines).toEqual([
      { pageId: 'a', line: 1, text: 'Ich war im Schwimbad.' },
      { pageId: 'a', line: 2, text: 'Es war schön.' },
      { pageId: 'b', line: 1, text: '' },
      { pageId: 'b', line: 2, text: '' },
    ]);
    expect(Object.keys(flow.getState().works)).toEqual(['first']);
  });

  it('reviews every work in order and counts them in the run', async () => {
    const { pages, fake, flow } = contentSetup(['a', 'b', 'c']);
    const works: ReviewWork[] = [
      { id: 'w1', pageIds: ['a'] },
      { id: 'w2', pageIds: ['b', 'c'] },
    ];
    const seen: string[] = [];
    flow.subscribe(() => {
      const run = flow.getState().run;
      if (run?.phase !== 'reviewing') return;
      const entry = `${run.finished}/${run.total}`;
      if (seen.at(-1) !== entry) seen.push(entry);
    });
    await flow.start(pages, DEUTSCH, CONTENT, works);

    expect(seen).toEqual(['0/2', '1/2', '2/2']);
    expect(fake.reviews.map((input) => input.lines.map((line) => line.pageId))).toEqual([
      ['a', 'a'],
      ['b', 'c'],
    ]);
    expect(Object.keys(flow.getState().works)).toEqual(['w1', 'w2']);
  });

  it.each([
    ['without an assignment', { ...DEFAULT_SCOPE, content: true }],
    ['with a blank assignment', { ...DEFAULT_SCOPE, content: true, assignment: ' \n\t ' }],
    ['without a form name', { ...DEFAULT_SCOPE, form: true }],
  ])('does not review %s', async (_name, scope) => {
    const { pages, fake, flow, works } = contentSetup();
    const watched = watchRuns(flow);
    await flow.start(pages, DEUTSCH, scope, works);

    expect(fake.reviews).toHaveLength(0);
    expect(watched.phases).not.toContain('reviewing');
    expect(flow.getState().works).toEqual({});
  });

  it('reviews the form alone when only a form name is given', async () => {
    const { pages, fake, flow, works } = contentSetup();
    const scope = { ...DEFAULT_SCOPE, form: true, formName: 'Persönlicher Brief' };
    await flow.start(pages, DEUTSCH, scope, works);
    expect(fake.reviews).toHaveLength(1);
    expect(flow.getState().works.w?.status).toBe('done');
  });

  it('keeps a failed review as a message on the work and leaves the pages untouched', async () => {
    const { pages, answer, flow, works } = contentSetup();
    answer.current = { ok: false, error: { kind: 'failed', message: 'Zeitüberschreitung' } };
    await flow.start(pages, DEUTSCH, CONTENT, works);

    expect(flow.getState().works.w).toMatchObject({
      status: 'failed',
      message: 'Der Text konnte nicht korrigiert werden (Zeitüberschreitung).',
      comments: [],
    });
    expect(flow.getState().pages.a?.status).toBe('done');
    expect(flow.getState().pages.b?.status).toBe('done');
    expect(flow.getState().outcome).toBe('finished');
  });

  it('runs a failed review again on the next start and clears the message', async () => {
    const { pages, answer, fake, flow, works } = contentSetup();
    answer.current = { ok: false, error: { kind: 'failed', message: 'Zeitüberschreitung' } };
    await flow.start(pages, DEUTSCH, CONTENT, works);
    answer.current = { ok: true, comments: [FORM_NAME], questions: 1 };
    await flow.start(pages, DEUTSCH, CONTENT, works);

    expect(fake.reviews).toHaveLength(2);
    expect(flow.getState().works.w).toMatchObject({
      status: 'done',
      message: null,
      comments: [{ ...FORM_NAME, status: 'open' }],
    });
  });

  it('reports an unexpected exception from the review without failing the run', async () => {
    const { pages, fake, flow, works } = contentSetup();
    const throwing: Corrector = {
      correct: (lines, profile, signal, scope) => fake.correct(lines, profile, signal, scope),
      review: () => Promise.reject(new Error('Speicher voll')),
    };
    flow.setReviewer(throwing);
    await flow.start(pages, DEUTSCH, CONTENT, works);

    expect(flow.getState().works.w).toMatchObject({
      status: 'failed',
      message: 'Der Text konnte nicht korrigiert werden (unerwarteter Fehler).',
    });
    expect(flow.getState().outcome).toBe('finished');
  });

  it('finishes a work without comments when the corrector cannot review', async () => {
    const { pages, fake, flow, works } = contentSetup();
    flow.setReviewer({
      correct: (lines, profile, signal, scope) => fake.correct(lines, profile, signal, scope),
    });
    await flow.start(pages, DEUTSCH, CONTENT, works);
    expect(flow.getState().works.w).toMatchObject({ status: 'done', comments: [] });
  });

  it('fails the review of a readable work when no reviewer is set after the pages were read', async () => {
    const { pages, flow, works } = contentSetup();
    await flow.start(pages, DEUTSCH, DEFAULT_SCOPE, works);
    flow.setReviewer(null);
    await flow.start(pages, DEUTSCH, CONTENT, works);
    expect(flow.getState().works.w).toMatchObject({ status: 'failed', message: REVIEWER_MISSING });
  });

  it('asks the reviewer and not the corrector for the review', async () => {
    const { pages, fake, flow, works } = contentSetup();
    const other = createFakeCorrector(
      (lines) => lines.join('\n'),
      (): ContentResult => ({ ok: true, comments: [FORM_NAME], questions: 1 }),
    );
    flow.setReviewer(other);
    await flow.start(pages, DEUTSCH, CONTENT, works);

    expect(fake.reviews).toHaveLength(0);
    expect(other.reviews).toHaveLength(1);
    expect(flow.getState().works.w?.comments).toEqual([{ ...FORM_NAME, status: 'open' }]);
  });

  it('does not need a reviewer when the scope has no content or form', async () => {
    const { pages, fake, flow, works } = contentSetup();
    flow.setReviewer(null);
    await flow.start(pages, DEUTSCH, { ...DEFAULT_SCOPE }, works);
    expect(flow.getState().pages.a?.status).toBe('done');
    expect(flow.getState().works.w).toBeUndefined();
    expect(fake.reviews).toHaveLength(0);
  });

  it('marks the work as cancelled when the run is cancelled during the review', async () => {
    const { pages, fake, flow, works } = contentSetup();
    const started = deferred();
    const gated: Corrector = {
      correct: (lines, profile, signal, scope) => fake.correct(lines, profile, signal, scope),
      review: (_input, signal) =>
        new Promise<ContentResult>((resolve) => {
          started.resolve();
          signal.addEventListener(
            'abort',
            () => {
              resolve({ ok: false, error: { kind: 'cancelled' } });
            },
            { once: true },
          );
        }),
    };
    flow.setReviewer(gated);
    const running = flow.start(pages, DEUTSCH, CONTENT, works);
    await waitFor(() => flow.getState().run?.phase === 'reviewing');
    await started.promise;
    expect(flow.getState().works.w?.status).toBe('reviewing');

    flow.cancel();
    await running;

    expect(flow.getState().works.w?.status).toBe('cancelled');
    expect(flow.getState()).toMatchObject({ outcome: 'cancelled', run: null, stopping: false });
    expect(flow.getState().pages.a?.status).toBe('done');
    expect(flow.getState().pages.b?.status).toBe('done');

    flow.setReviewer(fake);
    await flow.start(pages, DEUTSCH, CONTENT, works);
    expect(flow.getState().works.w?.status).toBe('done');
    expect(fake.reviews).toHaveLength(1);
  });

  it('does not start the review when the run is cancelled while correcting', async () => {
    const { pages, h, fake, flow, works } = contentSetup();
    const gate = deferred();
    h.locateGate = gate.promise;
    const running = flow.start(pages, DEUTSCH, CONTENT, works);
    await waitFor(() => h.log.includes('L:a'));
    flow.cancel();
    gate.resolve();
    await running;

    expect(fake.reviews).toHaveLength(0);
    expect(flow.getState().works.w).toBeUndefined();
    expect(flow.getState().outcome).toBe('cancelled');
  });

  it('dismisses and restores a comment and ignores unknown targets', async () => {
    const { pages, answer, flow, works } = contentSetup();
    answer.current = { ok: true, comments: [MISSING_TASK, FORM_NAME], questions: 2 };
    await flow.start(pages, DEUTSCH, CONTENT, works);
    const statuses = () => flow.getState().works.w?.comments.map((comment) => comment.status);

    flow.setComment('w', 1, 'dismissed');
    expect(statuses()).toEqual(['open', 'dismissed']);
    flow.setComment('w', 1, 'open');
    expect(statuses()).toEqual(['open', 'open']);

    const before = flow.getState();
    flow.setComment('w', 1, 'open');
    flow.setComment('w', 9, 'dismissed');
    flow.setComment('missing', 0, 'dismissed');
    expect(flow.getState()).toBe(before);
  });

  it('keeps a dismissed comment dismissed when a rerun returns the same comment', async () => {
    const { pages, answer, flow, works } = contentSetup();
    answer.current = { ok: true, comments: [MISSING_TASK, FORM_NAME], questions: 2 };
    await flow.start(pages, DEUTSCH, CONTENT, works);
    flow.setComment('w', 0, 'dismissed');

    await flow.start(
      pages,
      DEUTSCH,
      { ...CONTENT, assignment: 'Beschreibe einen Ausflug.' },
      works,
    );

    expect(flow.getState().works.w?.comments.map((comment) => comment.status)).toEqual([
      'dismissed',
      'open',
    ]);
  });

  it.each([
    ['another text', { ...MISSING_TASK, text: 'Thema verfehlt' }],
    ['another line', { ...MISSING_TASK, line: 1 }],
    ['another page', { ...MISSING_TASK, pageId: 'b', line: 1 }],
  ])('shows a comment with %s as open again after a rerun', async (_name, changed) => {
    const { pages, answer, flow, works } = contentSetup();
    await flow.start(pages, DEUTSCH, CONTENT, works);
    flow.setComment('w', 0, 'dismissed');
    answer.current = { ok: true, comments: [changed], questions: 2 };

    await flow.start(
      pages,
      DEUTSCH,
      { ...CONTENT, assignment: 'Beschreibe einen Ausflug.' },
      works,
    );

    expect(flow.getState().works.w?.comments).toEqual([{ ...changed, status: 'open' }]);
  });

  it('loses the dismissal when a review in between failed', async () => {
    const { pages, answer, flow, works } = contentSetup();
    await flow.start(pages, DEUTSCH, CONTENT, works);
    flow.setComment('w', 0, 'dismissed');
    answer.current = { ok: false, error: { kind: 'failed', message: 'weg' } };
    await flow.start(
      pages,
      DEUTSCH,
      { ...CONTENT, assignment: 'Beschreibe einen Ausflug.' },
      works,
    );
    expect(flow.getState().works.w?.comments).toEqual([]);
    answer.current = { ok: true, comments: [MISSING_TASK], questions: 2 };
    await flow.start(
      pages,
      DEUTSCH,
      { ...CONTENT, assignment: 'Beschreibe einen Ausflug.' },
      works,
    );
    expect(flow.getState().works.w?.comments).toEqual([{ ...MISSING_TASK, status: 'open' }]);
  });

  it('removes works that left the import and keeps works when no work ids are passed', async () => {
    const { pages, flow, works } = contentSetup();
    await flow.start(pages, DEUTSCH, CONTENT, works);

    flow.prune(new Set(['a', 'b']));
    expect(Object.keys(flow.getState().works)).toEqual(['w']);
    flow.prune(new Set(['a', 'b']), new Set(['w']));
    expect(Object.keys(flow.getState().works)).toEqual(['w']);
    flow.prune(new Set(['a', 'b']), new Set());
    expect(flow.getState().works).toEqual({});
    expect(Object.keys(flow.getState().pages)).toEqual(['a', 'b']);
  });

  it('logs only counts, flags and the duration of a review', async () => {
    const entries: ContentReviewLog[] = [];
    let clock = 1000;
    const { pages, answer, flow, works } = contentSetup(['a', 'b'], {
      logReview: (entry) => entries.push(entry),
      now: () => {
        clock += 40;
        return clock;
      },
    });
    await flow.start(pages, DEUTSCH, CONTENT, works);
    answer.current = { ok: false, error: { kind: 'failed', message: 'Geheimer Fehlertext' } };
    await flow.start(
      pages,
      DEUTSCH,
      { ...CONTENT, assignment: 'Beschreibe einen Ausflug.' },
      works,
    );

    expect(entries).toEqual([
      { ok: true, pages: 2, lines: 3, questions: 2, comments: 1, durationMs: 40 },
      { ok: false, pages: 2, lines: 3, questions: 0, comments: 0, durationMs: 40 },
    ]);
    for (const entry of entries) {
      expect(
        Object.values(entry).every((v) => typeof v === 'number' || typeof v === 'boolean'),
      ).toBe(true);
    }
    const serialized = JSON.stringify(entries);
    for (const secret of ['Schwimbad', 'Wir gingen', ASSIGNMENT, MISSING_TASK.text, 'Geheimer']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('does not log a review that was cancelled', async () => {
    const entries: ContentReviewLog[] = [];
    const { pages, fake, flow, works } = contentSetup(['a', 'b'], {
      logReview: (entry) => entries.push(entry),
    });
    const gated: Corrector = {
      correct: (lines, profile, signal, scope) => fake.correct(lines, profile, signal, scope),
      review: (_input, signal) =>
        new Promise<ContentResult>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve({ ok: false, error: { kind: 'cancelled' } });
            },
            { once: true },
          );
        }),
    };
    flow.setReviewer(gated);
    const running = flow.start(pages, DEUTSCH, CONTENT, works);
    await waitFor(() => flow.getState().works.w?.status === 'reviewing');
    flow.cancel();
    await running;
    expect(entries).toEqual([]);
  });

  it('still reviews the content when spelling and grammar are switched off', async () => {
    const { pages, fake, flow, works } = contentSetup();
    const scope = { ...CONTENT, spelling: false, grammar: false };
    await flow.start(pages, DEUTSCH, scope, works);

    expect(fake.calls).toHaveLength(0);
    expect(flow.getState().pages.a?.status).toBe('done');
    expect(flow.getState().pages.b?.status).toBe('done');
    expect(flow.getState().pages.a?.result?.statistics.errors).toBe(0);
    expect(fake.reviews).toHaveLength(1);
    expect(flow.getState().works.w?.status).toBe('done');
  });

  it('needs no corrector at all when spelling and grammar are switched off', async () => {
    const { pages, fake, flow, works } = contentSetup();
    flow.setCorrector(null);
    const scope = { ...CONTENT, spelling: false, grammar: false };
    await flow.start(pages, DEUTSCH, scope, works);

    expect(flow.getState().pages.a).toMatchObject({ status: 'done', message: null });
    expect(flow.getState().pages.b?.status).toBe('done');
    expect(flow.getState().pages.a?.result?.statistics.errors).toBe(0);
    expect(fake.reviews).toHaveLength(1);
    expect(flow.getState().works.w?.status).toBe('done');
  });

  it('still fails the pages without a corrector as soon as spelling or grammar is on', async () => {
    const { pages, fake, flow, works } = contentSetup();
    flow.setCorrector(null);
    await flow.start(pages, DEUTSCH, { ...CONTENT, spelling: false }, works);

    expect(flow.getState().pages.a).toMatchObject({ status: 'failed', message: CORRECTOR_MISSING });
    expect(flow.getState().works.w).toBeUndefined();
    expect(fake.reviews).toHaveLength(0);
  });
});
