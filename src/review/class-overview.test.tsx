// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { AppProvider } from '../app/app-context.tsx';
import { testAppModel, testWork } from '../app/test-app.ts';
import { defaultWeighting } from '../stats/weighting.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import { ClassOverviewDialog } from './ClassOverviewDialog.tsx';
import { buildOverview } from './overview.ts';
import { setupReview, waitFor } from './test-support.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

async function reviewed() {
  const harness = setupReview(['a', 'b', 'c', 'd']);
  harness.h.corrections['Wir gingen heim.'] = {
    ok: false,
    error: { kind: 'failed', message: 'Zeitüberschreitung' },
  };
  const [a, b, c, d] = harness.pages;
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new Error('missing pages');
  }
  const arbeiten: Arbeit[] = [
    { id: 'x', name: 'Aufsatz Ada', pages: [a, b] },
    { id: 'y', name: 'Aufsatz Ben', pages: [c] },
    { id: 'z', name: 'Aufsatz Cem', pages: [d] },
  ];
  await harness.flow.start([a, b, c], DEUTSCH);
  return { ...harness, arbeiten };
}

describe('buildOverview weighting', () => {
  it('weighs errors per Arbeit and for the class', async () => {
    const { arbeiten, flow, runner } = await reviewed();
    const half = {
      ...defaultWeighting(DEUTSCH),
      weights: { ...defaultWeighting(DEUTSCH).weights, R: 0.5 },
    };
    const overview = buildOverview(arbeiten, flow.getState(), runner.getState().entries, [], half);
    expect(overview.rows.map((row) => [row.weighted, row.quotient?.toFixed(1) ?? null])).toEqual([
      [0.5, '7.1'],
      [0, '0.0'],
      [null, null],
    ]);
    expect(overview.total).toMatchObject({ weighted: 0.5 });
    expect(overview.total?.quotient?.toFixed(1)).toBe('4.5');
  });

  it('has no weighted figures without a weighting', async () => {
    const { arbeiten, flow, runner } = await reviewed();
    const overview = buildOverview(arbeiten, flow.getState(), runner.getState().entries);
    expect(overview.rows.every((row) => row.quotient === null)).toBe(true);
  });
});

describe('buildOverview', () => {
  it('sums words and errors per Arbeit and tags incomplete ones briefly', async () => {
    const { arbeiten, flow, runner } = await reviewed();
    const overview = buildOverview(arbeiten, flow.getState(), runner.getState().entries);
    expect(overview.corrected).toBe(true);
    expect(
      overview.rows.map((row) => [row.name, row.words, row.errors, row.tag?.text ?? null]),
    ).toEqual([
      ['Aufsatz Ada', 7, 1, '1/2'],
      ['Aufsatz Ben', 4, 0, null],
      ['Aufsatz Cem', null, null, '0/1'],
    ]);
    expect(overview.rows[0]?.tag?.title).toBe('1 von 2 Seiten korrigiert, 1 mit Fehler');
    expect(overview.rows[2]?.tag?.title).toBe('0 von 1 Seite korrigiert, 1 offen');
    expect(overview.rows[0]?.top).toEqual([{ type: 'R', count: 1 }]);
    expect(overview.total).toMatchObject({ words: 11, errors: 1 });
    expect(overview.types).toEqual([{ type: 'R', count: 1 }]);
  });

  it('shows only words after counting and tags partly counted Arbeiten', async () => {
    const { arbeiten, flow, runner, h } = setupReviewForCount();
    h.transcripts.b = { ok: false, error: { kind: 'failed', message: 'leer' } };
    runner.start();
    await waitFor(() => runner.getState().batch === null);
    const overview = buildOverview(arbeiten, flow.getState(), runner.getState().entries);
    expect(overview.corrected).toBe(false);
    expect(overview.rows.map((row) => [row.name, row.words, row.tag?.text ?? null])).toEqual([
      ['Anna', 7, '1/2'],
      ['Ben', 4, null],
    ]);
    expect(overview.rows[0]?.tag?.title).toBe('1 von 2 Seiten gezählt');
    expect(overview.total).toMatchObject({ words: 11, errors: null, average: 4 });
  });
});

function setupReviewForCount() {
  const harness = setupReview(['a', 'b', 'c']);
  const [a, b, c] = harness.pages;
  if (a === undefined || b === undefined || c === undefined) throw new Error('missing pages');
  const arbeiten: Arbeit[] = [
    { id: 'anna', name: 'Anna', pages: [a, b] },
    { id: 'ben', name: 'Ben', pages: [c] },
  ];
  return { ...harness, arbeiten };
}

describe('ClassOverviewDialog', () => {
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

  it('shows the table with the error kinds and opens an Arbeit by its name', async () => {
    const { arbeiten, flow, runner } = await reviewed();
    const openArbeit = vi.fn<(id: string) => void>();
    act(() =>
      root.render(
        <AppProvider
          value={testAppModel({
            importState: { arbeiten },
            navigation: { overviewOpen: true, openArbeit },
            work: testWork({
              count: { runner, state: runner.getState() },
              review: { flow, state: flow.getState() },
            }),
          })}
        >
          <ClassOverviewDialog />
        </AppProvider>,
      ),
    );
    const rows = [...container.querySelectorAll('.overview-table tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent),
    );
    expect(rows).toEqual([
      ['Arbeit', 'Wörter', 'Fehler', 'Fehlerquotient', 'Häufigste Fehler'],
      ['Aufsatz Ada1/2', '7', '1', '14,3', 'R 1'],
      ['Aufsatz Ben', '4', '0', '0,0', '–'],
      ['Aufsatz Cem0/1', '–', '–', '–', '–'],
      ['Klasse', '11', '1', '9,1', 'R 1'],
    ]);
    expect(container.querySelector('.overview-types')?.textContent).toBe('RRechtschreibung1');
    expect(container.querySelector('tbody tr td:nth-child(4)')?.getAttribute('title')).toBe(
      '1 gewichtete Fehler',
    );

    const ben = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Aufsatz Ben',
    );
    act(() => ben?.click());
    expect(openArbeit).toHaveBeenCalledWith('y');
  });
});
