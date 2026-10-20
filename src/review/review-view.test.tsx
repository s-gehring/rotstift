// @vitest-environment happy-dom
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { createFakeCorrector } from '../correction/fake-corrector.ts';
import type { CorrectorStatus } from '../correction/provider.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { TranscriberStatus } from '../pipeline/transcriber.ts';
import type { Runner } from '../pipeline/runner.ts';
import { LAYOUT_FAILED, type ReviewFlow } from './review-flow.ts';
import { PREVIEW_NOTICE, ReviewControls, ReviewHint } from './ReviewControls.tsx';
import { ReviewView } from './ReviewView.tsx';
import { deferred, setupReview, waitFor } from './test-support.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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

function Harness({
  flow,
  runner,
  arbeiten,
  preview = false,
}: {
  readonly flow: ReviewFlow;
  readonly runner: Runner;
  readonly arbeiten: readonly Arbeit[];
  readonly preview?: boolean;
}) {
  const state = useSyncExternalStore(flow.subscribe, flow.getState);
  const runState = useSyncExternalStore(runner.subscribe, runner.getState);
  return (
    <ReviewView
      arbeiten={arbeiten}
      flow={flow}
      state={state}
      entries={runState.entries}
      canRetry
      preview={preview}
      onBack={() => undefined}
    />
  );
}

function buttonNamed(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === name,
  );
  if (found === undefined) throw new Error(`no button ${name}`);
  return found;
}

function pageItem(position: number): HTMLElement {
  const item = container.querySelectorAll<HTMLElement>('.review-page')[position - 1];
  if (item === undefined) throw new Error(`no page ${position}`);
  return item;
}

async function reviewed(preview = false) {
  const harness = setupReview(['a', 'b', 'c', 'd']);
  harness.h.transcripts.c = { ok: true, lines: [''] };
  harness.h.corrections['Wir gingen heim.'] = {
    ok: false,
    error: { kind: 'failed', message: 'Zeitüberschreitung' },
  };
  const [a, b, c, d] = harness.pages;
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new Error('missing pages');
  }
  const arbeiten: Arbeit[] = [
    { id: 'x', name: 'Aufsatz Ada', pages: [a, b, c] },
    { id: 'y', name: 'Aufsatz Ben', pages: [d] },
  ];
  await harness.flow.start(harness.pages, DEUTSCH);
  act(() =>
    root.render(
      <Harness flow={harness.flow} runner={harness.runner} arbeiten={arbeiten} preview={preview} />,
    ),
  );
  return { ...harness, arbeiten };
}

describe('ReviewView', () => {
  it('lists every mark of a page with line, code and correction', async () => {
    await reviewed();
    const marks = pageItem(1).querySelectorAll('.mark-list li');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe('Zeile 1 R (Rechtschreibung)„Schwimbad“ → „Schwimmbad“');
    expect(pageItem(1).querySelector('.status')?.textContent).toBe('1 Fehler');
  });

  it('shows the class overview with per-arbeit and class totals', async () => {
    await reviewed();
    const rows = [...container.querySelectorAll('.class-overview tbody tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent),
    );
    expect(rows).toEqual([
      [
        'Aufsatz Ada',
        'Unvollständig: 2 von 3 Seiten berichtigt, 1 leer, 1 mit Problem',
        '7',
        '1',
        '14,3',
        'R (1)',
      ],
      ['Aufsatz Ben', '1 von 1 berichtigt', '1', '0', '0,0', 'keine'],
    ]);
    const total = container.querySelector('.class-overview tfoot tr');
    expect(total?.textContent).toContain('Klasse gesamt');
    expect(total?.textContent).toContain('2 Arbeiten, davon 1 unvollständig');
  });

  it('switches between the page with notes and the original', async () => {
    await reviewed();
    const overlay = () => pageItem(1).querySelector('svg[aria-label="Korrekturen"]');
    expect(overlay()).not.toBeNull();

    const original = [...container.querySelectorAll('label')].find(
      (label) => label.textContent === 'Original',
    );
    act(() => original?.querySelector('input')?.click());
    expect(overlay()).toBeNull();
    expect(pageItem(1).querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
  });

  it('marks empty and failed pages and retries a failed page on request', async () => {
    const { h } = await reviewed();
    expect(pageItem(3).querySelector('.status')?.textContent).toBe(
      'Keine Schrift erkannt, nicht berichtigt',
    );
    expect(pageItem(2).querySelector('.status')?.textContent).toBe(
      'Problem: Korrektur fehlgeschlagen',
    );
    expect(pageItem(2).querySelector('.error-text')?.textContent).toBe(
      'Der Text konnte nicht korrigiert werden (Zeitüberschreitung).',
    );

    delete h.corrections['Wir gingen heim.'];
    await act(async () => {
      buttonNamed('Seite 2 erneut berichtigen').click();
      await waitFor(() => pageItem(2).dataset.status === 'done');
    });
    expect(pageItem(2).querySelector('.status')?.textContent).toBe('0 Fehler');
  });

  it('marks a page as outdated after its text was edited and leaves it out of the statistics', async () => {
    const { runner } = await reviewed();
    act(() => runner.edit('a', 'Ganz neuer Text.'));
    expect(pageItem(1).querySelector('.status')?.textContent).toBe(
      'Veraltet: Nach Drehen oder Bearbeiten bitte erneut berichtigen',
    );
    expect(pageItem(1).querySelector('svg[aria-label="Korrekturen"]')).toBeNull();
    expect(pageItem(1).querySelector('.mark-list')).toBeNull();
    expect(buttonNamed('Seite 1 erneut berichtigen')).toBeDefined();
    const ada = container.querySelector('.class-overview tbody tr');
    expect(ada?.children[1]?.textContent).toContain('1 veraltet');
    expect(ada?.children[2]?.textContent).toBe('–');
  });

  it('shows why the notes could not be drawn', async () => {
    const harness = setupReview(['a']);
    harness.h.layoutFails = true;
    await harness.flow.start(harness.pages, DEUTSCH);
    const arbeiten: Arbeit[] = [{ id: 'x', name: 'Aufsatz Ada', pages: harness.pages }];
    act(() =>
      root.render(<Harness flow={harness.flow} runner={harness.runner} arbeiten={arbeiten} />),
    );
    expect(pageItem(1).querySelector('.notice.warn')?.textContent).toBe(LAYOUT_FAILED);
    expect(pageItem(1).textContent).toContain('kaputt');
  });

  it('opens another arbeit from the class overview', async () => {
    await reviewed();
    expect(container.querySelector('#arbeit-review-title')?.textContent).toBe('Aufsatz Ada');
    act(() => buttonNamed('Aufsatz Ben').click());
    expect(container.querySelector('#arbeit-review-title')?.textContent).toBe('Aufsatz Ben');
    expect(buttonNamed('Aufsatz Ben').getAttribute('aria-pressed')).toBe('true');
  });

  it('labels the preview corrections', async () => {
    await reviewed(true);
    expect(container.textContent).toContain(PREVIEW_NOTICE);
  });

  it('shows the phase and cancels a running review', async () => {
    const { pages, h, flow, runner } = setupReview(['a']);
    const gate = deferred();
    h.correctGate = gate.promise;
    const arbeiten: Arbeit[] = [{ id: 'x', name: 'Aufsatz Ada', pages }];
    act(() => root.render(<Harness flow={flow} runner={runner} arbeiten={arbeiten} />));
    let running: Promise<void> = Promise.resolve();
    await act(async () => {
      running = flow.start(pages, DEUTSCH);
      await waitFor(() => flow.getState().run?.phase === 'correcting');
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Korrektur: Seite 1 von 1',
    );

    await act(async () => {
      buttonNamed('Abbrechen').click();
      await running;
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Abgebrochen.');
    expect(pageItem(1).querySelector('.status')?.textContent).toBe(
      'Problem: Abgebrochen, nicht berichtigt',
    );
  });
});

const READY_TRANSCRIBER: TranscriberStatus = {
  state: 'ready',
  transcriber: { transcribe: () => Promise.resolve({ ok: true, lines: [] }) },
  demo: true,
};

function controls(corrector: CorrectorStatus | null, onStart = vi.fn<() => void>()) {
  act(() =>
    root.render(
      <>
        <ReviewControls
          state={{ pages: {}, profile: null, run: null, stopping: false, outcome: null }}
          profile={DEUTSCH}
          onProfile={() => undefined}
          transcriber={READY_TRANSCRIBER}
          corrector={corrector}
          pageCount={2}
          counting={false}
          onStart={onStart}
          onOpen={() => undefined}
        />
        <ReviewHint corrector={corrector} />
      </>,
    ),
  );
  return onStart;
}

describe('ReviewControls', () => {
  it('starts the review with a ready corrector', () => {
    const onStart = controls({
      state: 'ready',
      corrector: createFakeCorrector('x'),
      preview: true,
    });
    act(() => buttonNamed('Berichtigen').click());
    expect(onStart).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(PREVIEW_NOTICE);
  });

  it('stays disabled and says why while the correction model is missing', () => {
    controls({ state: 'needs-model', message: 'Korrekturmodell fehlt.' });
    expect(buttonNamed('Berichtigen').disabled).toBe(true);
    expect(container.querySelector('#review-hint')?.textContent).toBe('Korrekturmodell fehlt.');
  });
});
