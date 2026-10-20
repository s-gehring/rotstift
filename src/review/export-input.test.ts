// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import type { PageImageEncoder } from '../export/types.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import { arbeitExportBlock, createReviewExport } from './export-input.ts';
import { readingOf, setupReview } from './test-support.ts';

async function reviewed() {
  const harness = setupReview(['a', 'b', 'c']);
  harness.h.transcripts.b = { ok: true, lines: [''] };
  await harness.flow.start(harness.pages, DEUTSCH);
  const [a, b, c] = harness.pages;
  if (a === undefined || b === undefined || c === undefined) throw new Error('missing pages');
  const complete: Arbeit = { id: 'x', name: 'Aufsatz Ada', pages: [a, b] };
  const other: Arbeit = { id: 'y', name: 'Aufsatz Ben', pages: [c] };
  return { ...harness, complete, other };
}

describe('createReviewExport', () => {
  it('builds a corrected Arbeit from the stored images, marks and statistics', async () => {
    const { flow, runner, complete } = await reviewed();
    const render = vi.fn<(page: ImportPage) => Promise<Blob>>((page) =>
      Promise.resolve(new Blob([`png-${page.id}`])),
    );
    const encode = vi.fn<PageImageEncoder>(() =>
      Promise.resolve({ bytes: new Uint8Array(), format: 'jpeg' }),
    );
    const exporter = createReviewExport(render, encode);
    const state = flow.getState();
    const entries = runner.getState().entries;

    const arbeit = exporter.correctedArbeit(complete, state, entries, DEUTSCH);

    expect(arbeit).toMatchObject({
      title: 'Aufsatz Ada',
      profile: DEUTSCH,
      statistics: { words: 7, errors: 1 },
    });
    const [first, second] = arbeit?.pages ?? [];
    expect(first).toMatchObject({ width: 1000, height: 1400 });
    expect(first?.image).toBe(state.pages.a?.image?.blob);
    expect(first?.transcript).toBe(state.pages.a?.result?.transcript);
    expect(second?.transcript).toBeUndefined();

    if (second === undefined) throw new Error('missing page');
    await exporter.encodePage(second, DEUTSCH);
    expect(render).toHaveBeenCalledWith(complete.pages[1]);
    expect(await encode.mock.calls[0]?.[0].image.text()).toBe('png-b');
  });

  it('exports hints only after they were accepted as marks', async () => {
    const harness = setupReview(['a']);
    harness.h.transcripts.a = {
      ok: true,
      lines: ['Ich war im Schwimbad.', 'Es war schön.'],
      reading: readingOf(['Ich war im Schwimbad.', 'Es war schön.'], { 'Schwimbad.': 0.3 }),
    };
    await harness.flow.start(harness.pages, DEUTSCH);
    const arbeit: Arbeit = { id: 'x', name: 'Aufsatz Ada', pages: harness.pages };
    const exporter = createReviewExport();
    const entries = harness.runner.getState().entries;
    const exported = () =>
      exporter.correctedArbeit(arbeit, harness.flow.getState(), entries, DEUTSCH);
    const marks = () => exported()?.pages[0]?.transcript?.lines.flatMap((line) => line.marks);

    expect(exported()?.statistics).toMatchObject({ words: 7, errors: 0 });
    expect(marks()).toEqual([]);

    harness.flow.setHint('a', 0, 'accepted');
    expect(exported()?.statistics).toMatchObject({ errors: 1 });
    expect(marks()).toEqual([expect.objectContaining({ correction: 'Schwimmbad' })]);

    harness.flow.setHint('a', 0, 'dismissed');
    expect(exported()?.statistics).toMatchObject({ errors: 0 });
    expect(marks()).toEqual([]);
  });

  it('leaves incomplete and preview Arbeiten out', async () => {
    const { pages, h, flow, runner, complete, other, corrector } = await reviewed();
    h.corrections['Der Tag war lang.'] = {
      ok: false,
      error: { kind: 'failed', message: 'Zeitüberschreitung' },
    };
    const [, , c] = pages;
    if (c === undefined) throw new Error('missing page');
    await flow.retry(c);
    const exporter = createReviewExport();
    const entries = runner.getState().entries;

    expect(exporter.correctedArbeit(other, flow.getState(), entries, DEUTSCH)).toBeNull();
    expect(arbeitExportBlock(other, flow.getState(), entries)).toBe('incomplete');
    expect(
      exporter
        .classArbeiten([complete, other], flow.getState(), entries, DEUTSCH)
        .map((a) => [a.kind, a.title]),
    ).toEqual([['corrected', 'Aufsatz Ada']]);

    flow.setCorrector(corrector, true);
    await flow.start(pages, { ...DEUTSCH, id: 'vorschau' });
    expect(arbeitExportBlock(complete, flow.getState(), entries)).toBe('preview');
    expect(exporter.correctedArbeit(complete, flow.getState(), entries, DEUTSCH)).toBeNull();
  });
});
