// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEUTSCH, ENGLISCH } from '../annotations/profile.ts';
import { CORRECTOR_MISSING } from './review-flow.ts';
import { deferred, setupReview, waitFor } from './test-support.ts';

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
    expect(result?.image?.url).toBe('blob:a');
    const line = result?.result?.transcript.lines[0];
    expect(line?.bbox).toEqual({ x: 100, y: 100, width: 700, height: 40 });
    expect(line?.marks).toEqual([
      expect.objectContaining({ type: 'R', original: 'Schwimbad', correction: 'Schwimmbad' }),
    ]);
    expect(result?.result?.statistics).toMatchObject({ words: 7, errors: 1 });
    expect(result?.result?.unplacedLines).toEqual([]);
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

  it('cancels while locating lines', async () => {
    const { pages, h, flow, released } = setupReview(['a', 'b']);
    const gate = deferred();
    h.locateGate = gate.promise;
    const running = flow.start(pages, DEUTSCH);
    await waitFor(() => h.log.includes('L:a'));
    expect(flow.getState().run?.phase).toBe('locating');

    flow.cancel();
    await running;
    gate.resolve();

    expect(flow.getState().pages.a?.status).toBe('cancelled');
    expect(flow.getState().pages.b?.status).toBe('cancelled');
    expect(h.log.some((entry) => entry.startsWith('C:'))).toBe(false);
    expect(released).toContain('blob:a');
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

  it('drops pages that left the import and releases their images', async () => {
    const { pages, flow, released } = setupReview(['a', 'b']);
    await flow.start(pages, DEUTSCH);
    flow.prune(new Set(['a']));
    expect(Object.keys(flow.getState().pages)).toEqual(['a']);
    expect(released).toEqual(['blob:b']);
  });
});
