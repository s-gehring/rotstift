// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEUTSCH, ENGLISCH } from '../annotations/profile.ts';
import { CORRECTOR_MISSING, IMAGE_FAILED, LAYOUT_FAILED, NOT_RERECOGNIZED } from './review-flow.ts';
import { DEFAULT_SCOPE } from '../correction/scope.ts';
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
