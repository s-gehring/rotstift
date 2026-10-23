// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import type { ContentInput } from '../content-form/review.ts';
import type { Corrector } from '../correction/corrector.ts';
import { DEFAULT_SCOPE, type CorrectionScope } from '../correction/scope.ts';
import { withPseudonymization } from '../privacy/pseudonymizing-corrector.ts';
import type { DetectorContext } from '../privacy/types.ts';
import { detectWork, type DetectWork } from '../privacy-review/detect.ts';
import { DETECT_FAILED, reviewWorks, type Shields } from './review-flow.ts';
import { deferred, setupReview, tick, waitFor } from './test-support.ts';

const ARBEITEN = [
  { id: 'w1', name: 'Lena Schmidt', pages: [{ id: 'a' }] },
  { id: 'w2', name: 'Paul Becker', pages: [{ id: 'b' }] },
];

const WORKS = reviewWorks(ARBEITEN);

const CONTENT: CorrectionScope = { ...DEFAULT_SCOPE, content: true, assignment: 'Ein Erlebnis' };

function remote(log: string[]): Corrector & { readonly sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    correct(lines) {
      const text = lines.join('\n');
      log.push(`R:${lines[0] ?? ''}`);
      sent.push(text);
      return Promise.resolve({ ok: true, correctedText: text.replace('Schwimbad', 'Schwimmbad') });
    },
    review(input: ContentInput) {
      log.push(`V:${input.lines[0]?.text ?? ''}`);
      sent.push(input.lines.map((line) => line.text).join('\n'));
      return Promise.resolve({ ok: true, comments: [], questions: 1 });
    },
  };
}

function setup(options: { readonly detect?: DetectWork } = {}) {
  const contexts: DetectorContext[] = [];
  const review = setupReview(['a', 'b'], {
    detect: async (pages, context, signal) => {
      review.h.log.push(`D:${context.workName}`);
      contexts.push(context);
      return (options.detect ?? detectWork)(pages, context, signal);
    },
  });
  review.h.transcripts.a = {
    ok: true,
    lines: ['Ich heiße Lena Schmidt.', 'Lena war im Schwimbad.'],
  };
  review.h.transcripts.b = { ok: true, lines: ['Paul ging mit Tom heim.'] };
  const cloud = remote(review.h.log);
  const shields: Shields = { corrector: (pages) => withPseudonymization(cloud, pages) };
  review.flow.setShields(shields);
  return { ...review, cloud, shields, contexts };
}

const privacyOf = (flow: ReturnType<typeof setup>['flow'], id: string) =>
  flow.getState().privacy?.find((work) => work.id === id);

describe('review flow with protection', () => {
  it('reads every page, detects per work and sends nothing before the release', async () => {
    const { pages, h, flow, cloud, contexts } = setup();
    const run = flow.start(pages, DEUTSCH, DEFAULT_SCOPE, WORKS);
    await waitFor(() => flow.getState().run?.phase === 'awaiting');

    expect(h.log.filter((entry) => entry.startsWith('T:'))).toHaveLength(2);
    expect(h.log.filter((entry) => entry.startsWith('D:'))).toEqual([
      'D:Lena Schmidt',
      'D:Paul Becker',
    ]);
    const lastRead = h.log.findLastIndex((entry) => entry.startsWith('T:'));
    expect(h.log.findIndex((entry) => entry.startsWith('D:'))).toBeGreaterThan(lastRead);
    expect(contexts[0]).toEqual({ workName: 'Lena Schmidt', subject: 'Deutsch', language: 'de' });
    expect(cloud.sent).toEqual([]);
    expect(h.log.some((entry) => entry.startsWith('C:'))).toBe(false);
    expect(flow.getState().privacy?.map((work) => work.status)).toEqual(['open', 'open']);
    expect(flow.getState().pages.a?.status).toBe('waiting');
    expect(flow.getState().run?.pending).toMatchObject({ confirm: 2, correct: 2 });

    flow.release('w1');
    flow.release('w2');
    await run;
    expect(h.log.findIndex((entry) => entry.startsWith('R:'))).toBeGreaterThan(
      h.log.findLastIndex((entry) => entry.startsWith('D:')),
    );
    expect(flow.getState().outcome).toBe('finished');
    expect(flow.getState().privacy).toBeNull();
  });

  it('sends only placeholders and draws the marks on the original text', async () => {
    const { pages, flow, cloud } = setup();
    const run = flow.start(pages, DEUTSCH, DEFAULT_SCOPE, WORKS);
    await waitFor(() => flow.getState().run?.phase === 'awaiting');
    flow.release('w1');
    flow.release('w2');
    await run;

    expect(cloud.sent).toEqual([
      'Ich heiße [Person 1].\n[Person 2] war im Schwimbad.',
      '[Person 1] ging mit Tom heim.',
    ]);
    for (const text of cloud.sent) {
      expect(text).not.toMatch(/Lena|Schmidt|Paul/u);
    }
    const lines = flow.getState().pages.a?.result?.transcript.lines;
    expect(lines?.map((line) => line.text)).toEqual([
      'Ich heiße Lena Schmidt.',
      'Lena war im Schwimbad.',
    ]);
    expect(lines?.[1]?.marks).toEqual([
      expect.objectContaining({ original: 'Schwimbad', correction: 'Schwimmbad' }),
    ]);
  });

  it('corrects a released work while the teacher still checks the other one', async () => {
    const { pages, h, flow, cloud } = setup();
    const run = flow.start(pages, DEUTSCH, DEFAULT_SCOPE, WORKS);
    await waitFor(() => flow.getState().run?.phase === 'awaiting');
    flow.release('w2');
    await waitFor(() => flow.getState().pages.b?.status === 'done');

    expect(cloud.sent).toEqual(['[Person 1] ging mit Tom heim.']);
    expect(flow.getState().pages.a?.status).toBe('waiting');
    expect(flow.getState().run?.phase).toBe('awaiting');
    expect(flow.getState().run?.pending).toMatchObject({ confirm: 1, correct: 1 });

    flow.release('w1');
    await run;
    expect(h.log.filter((entry) => entry.startsWith('R:'))).toHaveLength(2);
  });

  it('never sends a work that was not released, also when the run is cancelled', async () => {
    const { pages, flow, cloud } = setup();
    const run = flow.start(pages, DEUTSCH, DEFAULT_SCOPE, WORKS);
    await waitFor(() => flow.getState().run?.phase === 'awaiting');
    flow.release('w2');
    await waitFor(() => flow.getState().pages.b?.status === 'done');
    flow.cancel();
    await run;

    expect(cloud.sent).toEqual(['[Person 1] ging mit Tom heim.']);
    expect(flow.getState().pages.a?.status).toBe('cancelled');
    expect(flow.getState().outcome).toBe('cancelled');
    expect(flow.getState().privacy).toBeNull();
  });

  it('sends nothing when the run is cancelled while the teacher checks', async () => {
    const { pages, flow, cloud, h } = setup();
    const run = flow.start(pages, DEUTSCH, DEFAULT_SCOPE, WORKS);
    await waitFor(() => flow.getState().run?.phase === 'awaiting');
    flow.cancel();
    await run;
    flow.release('w1');
    await tick();

    expect(cloud.sent).toEqual([]);
    expect(h.log.some((entry) => entry.startsWith('C:'))).toBe(false);
    expect(flow.getState().pages.a?.status).toBe('cancelled');
    expect(flow.getState().pages.b?.status).toBe('cancelled');
  });

  it('cancels a detection that is still running without sending anything', async () => {
    const gate = deferred();
    const { pages, flow, cloud } = setup({
      detect: async (found, context, signal) => {
        await gate.promise;
        return detectWork(found, context, signal);
      },
    });
    const run = flow.start(pages, DEUTSCH, DEFAULT_SCOPE, WORKS);
    await waitFor(() => flow.getState().run?.phase === 'detecting');
    expect(privacyOf(flow, 'w1')?.status).toBe('detecting');
    flow.release('w1');
    flow.cancel();
    gate.resolve();
    await run;

    expect(cloud.sent).toEqual([]);
    expect(flow.getState().outcome).toBe('cancelled');
  });

  it('keeps waiting for the release when the protection is switched off during the run', async () => {
    const { pages, flow, cloud, h } = setup();
    const run = flow.start(pages, DEUTSCH, DEFAULT_SCOPE, WORKS);
    await waitFor(() => flow.getState().run?.phase === 'awaiting');
    flow.setShields({});
    await tick();
    await tick();

    expect(cloud.sent).toEqual([]);
    expect(h.log.some((entry) => entry.startsWith('C:'))).toBe(false);
    flow.release('w1');
    flow.release('w2');
    await run;
    expect(cloud.sent[1]).toBe('[Person 1] ging mit Tom heim.');
    expect(h.log.some((entry) => entry.startsWith('C:'))).toBe(false);
  });

  it('runs as before without protection', async () => {
    const { pages, flow, cloud, h } = setup();
    flow.setShields({});
    await flow.start(pages, DEUTSCH, DEFAULT_SCOPE, WORKS);

    expect(cloud.sent).toEqual([]);
    expect(h.log.some((entry) => entry.startsWith('D:'))).toBe(false);
    expect(h.log.filter((entry) => entry.startsWith('C:'))).toEqual([
      'C:Ich heiße Lena Schmidt.',
      'C:Paul ging mit Tom heim.',
    ]);
    expect(flow.getState().privacy).toBeNull();
  });

  it('protects nothing for a count of words only scope without codes', async () => {
    const { pages, flow, cloud, h } = setup();
    await flow.start(
      pages,
      { ...DEUTSCH, allowedTypes: [] },
      { ...DEFAULT_SCOPE, spelling: false, grammar: false },
      WORKS,
    );

    expect(cloud.sent).toEqual([]);
    expect(h.log.some((entry) => entry.startsWith('D:'))).toBe(false);
  });

  it('replaces what the teacher adds and keeps a removed identifier removed', async () => {
    const { pages, flow, cloud } = setup();
    const run = flow.start(pages, DEUTSCH, DEFAULT_SCOPE, WORKS);
    await waitFor(() => flow.getState().run?.phase === 'awaiting');

    flow.addIdentifier('w2', 'b', { line: 1, offset: 14, length: 3 }, 'person');
    flow.removeIdentifier('w2', 'b', { line: 1, offset: 0, length: 4 });
    flow.addIdentifier('w2', 'b', { line: 1, offset: 5, length: 4 }, 'place');
    expect(privacyOf(flow, 'w2')?.removed).toEqual(['paul']);
    flow.release('w2');
    flow.addIdentifier('w2', 'b', { line: 1, offset: 0, length: 4 }, 'person');
    flow.release('w1');
    await run;

    expect(cloud.sent).toContain('Paul [Ort 1] mit [Person 1] heim.');
  });

  it('marks the pages of a work as failed when its detection fails', async () => {
    const { pages, flow, cloud } = setup({
      detect: (found, context, signal) =>
        context.workName === 'Paul Becker'
          ? Promise.reject(new Error('kaputt'))
          : detectWork(found, context, signal),
    });
    const run = flow.start(pages, DEUTSCH, DEFAULT_SCOPE, WORKS);
    await waitFor(() => flow.getState().run?.phase === 'awaiting');

    expect(privacyOf(flow, 'w2')?.status).toBe('failed');
    expect(flow.getState().pages.b).toMatchObject({ status: 'failed', message: DETECT_FAILED });
    flow.release('w2');
    flow.release('w1');
    await run;
    expect(cloud.sent).toHaveLength(1);
    expect(flow.getState().pages.b?.status).toBe('failed');
  });

  it('detects again on a new run of the same work', async () => {
    const { pages, flow, h } = setup();
    const first = flow.start(pages, DEUTSCH, DEFAULT_SCOPE, WORKS);
    await waitFor(() => flow.getState().run?.phase === 'awaiting');
    flow.addIdentifier('w2', 'b', { line: 1, offset: 14, length: 3 }, 'person');
    flow.release('w1');
    flow.release('w2');
    await first;
    const page = pages[1];
    if (page === undefined) throw new Error('page missing');

    const again = flow.retry(page, { recognize: true });
    await waitFor(() => flow.getState().run?.phase === 'awaiting');
    expect(h.log.filter((entry) => entry === 'D:Paul Becker')).toHaveLength(2);
    expect(flow.getState().privacy?.map((work) => work.id)).toEqual(['w2']);
    const spans = privacyOf(flow, 'w2')?.pages[0]?.spans ?? [];
    expect(spans.some((span) => span.source === 'teacher')).toBe(false);
    flow.release('w2');
    await again;
  });

  it('drops the spans of pages that leave the work during the check', async () => {
    const { pages, flow } = setup();
    const run = flow.start(pages, DEUTSCH, DEFAULT_SCOPE, WORKS);
    await waitFor(() => flow.getState().run?.phase === 'awaiting');
    flow.prune(new Set(['a']), new Set(['w1']));

    expect(flow.getState().privacy?.map((work) => work.id)).toEqual(['w1']);
    flow.release('w1');
    await run;
    expect(flow.getState().outcome).toBe('finished');
  });

  it('pseudonymizes the content review and keeps a local correction unwrapped', async () => {
    const { pages, flow, cloud, h, contexts } = setup();
    flow.setShields({ reviewer: (found) => withPseudonymization(cloud, found) });
    const run = flow.start(pages, DEUTSCH, CONTENT, WORKS);
    await waitFor(() => flow.getState().run?.phase === 'awaiting');

    expect(h.log.filter((entry) => entry.startsWith('C:'))).toHaveLength(2);
    expect(contexts[0]?.task).toBe('Ein Erlebnis');
    expect(cloud.sent).toEqual([]);
    flow.release('w1');
    flow.release('w2');
    await run;
    expect(cloud.sent).toEqual([
      'Ich heiße [Person 1].\n[Person 2] war im Schwimbad.',
      '[Person 1] ging mit Tom heim.',
    ]);
    expect(flow.getState().works.w1?.status).toBe('done');
  });
});
