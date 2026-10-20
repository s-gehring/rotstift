// @vitest-environment happy-dom
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { Runner } from '../pipeline/runner.ts';
import type { SaveOutcome } from '../export/save-file.ts';
import { saveClassPdf, saveCorrectedPdf, type SavePdfOptions } from '../export/save-pdf.ts';
import { createReviewExport, PDF_FOOTER } from './export-input.ts';
import { LAYOUT_FAILED, type ReviewFlow, type ReviewState } from './review-flow.ts';
import { usePdfSave } from './ReviewPdf.tsx';
import { ClassOverview, ReviewView } from './ReviewView.tsx';
import type { Entries } from './summary.ts';
import { deferred, readingOf, setupReview, tick, waitFor } from './test-support.ts';

vi.mock('../export/save-pdf.ts', () => ({
  saveCorrectedPdf: vi.fn<() => void>(),
  saveClassPdf: vi.fn<() => void>(),
}));

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

const exporter = createReviewExport();

function Overview({
  arbeiten,
  state,
  entries,
  selected,
  onSelect,
}: {
  readonly arbeiten: readonly Arbeit[];
  readonly state: ReviewState;
  readonly entries: Entries;
  readonly selected: string | undefined;
  readonly onSelect: (id: string) => void;
}) {
  const pdf = usePdfSave();
  if (state.profile === null) return null;
  return (
    <ClassOverview
      arbeiten={arbeiten}
      state={state}
      entries={entries}
      profile={state.profile}
      selected={selected}
      onSelect={onSelect}
      pdf={pdf}
      exporter={exporter}
    />
  );
}

function Harness({
  flow,
  runner,
  arbeiten,
  arbeitId = 'x',
  overview = false,
}: {
  readonly flow: ReviewFlow;
  readonly runner: Runner;
  readonly arbeiten: readonly Arbeit[];
  readonly arbeitId?: string;
  readonly overview?: boolean;
}) {
  const state = useSyncExternalStore(flow.subscribe, flow.getState);
  const runState = useSyncExternalStore(runner.subscribe, runner.getState);
  return (
    <>
      <ReviewView
        arbeiten={arbeiten}
        arbeitId={arbeitId}
        flow={flow}
        state={state}
        entries={runState.entries}
        canRetry
      />
      {overview && (
        <Overview
          arbeiten={arbeiten}
          state={state}
          entries={runState.entries}
          selected={arbeitId}
          onSelect={() => undefined}
        />
      )}
    </>
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

async function reviewed(options: { arbeitId?: string; overview?: boolean } = {}) {
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
      <Harness
        flow={harness.flow}
        runner={harness.runner}
        arbeiten={arbeiten}
        {...(options.arbeitId !== undefined && { arbeitId: options.arbeitId })}
        {...(options.overview !== undefined && { overview: options.overview })}
      />,
    ),
  );
  return { ...harness, arbeiten };
}

async function withHint() {
  const harness = setupReview(['a']);
  const lines = ['Ich war im Schwimbad.', 'Es war schön.'];
  harness.h.transcripts.a = {
    ok: true,
    lines,
    reading: readingOf(lines, { 'Schwimbad.': 0.3 }),
  };
  await harness.flow.start(harness.pages, DEUTSCH);
  const arbeiten: Arbeit[] = [{ id: 'x', name: 'Aufsatz Ada', pages: harness.pages }];
  act(() =>
    root.render(
      <Harness flow={harness.flow} runner={harness.runner} arbeiten={arbeiten} overview />,
    ),
  );
}

const head = () => pageItem(1).querySelector('.review-page-head')?.textContent;
const spot = () => pageItem(1).querySelector<SVGGElement>('.hint-spot');
const hintItem = () => pageItem(1).querySelector('.hint-list li')?.textContent;
const tap = () =>
  act(() => {
    spot()?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    spot()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

function SelectHarness({
  flow,
  runner,
  arbeiten,
  selected,
  onSelect,
}: {
  readonly flow: ReviewFlow;
  readonly runner: Runner;
  readonly arbeiten: readonly Arbeit[];
  readonly selected: string;
  readonly onSelect: (id: string) => void;
}) {
  const state = useSyncExternalStore(flow.subscribe, flow.getState);
  const runState = useSyncExternalStore(runner.subscribe, runner.getState);
  return (
    <Overview
      arbeiten={arbeiten}
      state={state}
      entries={runState.entries}
      selected={selected}
      onSelect={onSelect}
    />
  );
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
    await reviewed({ overview: true });
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

  it('shows uncertainly read places as hints and lets the list accept, discard and restore them', async () => {
    await withHint();
    expect(head()).toContain('0 Fehler');
    expect(head()).toContain('1 Stelle unsicher gelesen');
    expect(pageItem(1).querySelectorAll('.mark-list li')).toHaveLength(0);
    expect(pageItem(1).querySelector('.hint-list summary')?.textContent).toBe(
      '1 Stelle unsicher gelesen',
    );
    expect(hintItem()).toContain('„Schwimbad“ → „Schwimmbad“ (unsicher gelesen)');

    act(() => buttonNamed('Als Fehler übernehmen').click());
    expect(head()).toContain('1 Fehler');
    expect(head()).not.toContain('unsicher gelesen');
    expect(pageItem(1).querySelectorAll('.mark-list li')).toHaveLength(1);
    expect(hintItem()).toContain('(als Fehler übernommen)');
    expect(container.querySelector('.class-overview tbody tr')?.textContent).toContain('R (1)');

    act(() => buttonNamed('Verwerfen').click());
    expect(head()).toContain('0 Fehler');
    expect(spot()).toBeNull();
    expect(hintItem()).toContain('(verworfen)');

    act(() => buttonNamed('Wiederherstellen').click());
    expect(head()).toContain('1 Stelle unsicher gelesen');
    expect(spot()).not.toBeNull();
  });

  it('shows the suggestion on the first tap and switches only between hint and mark on the page', async () => {
    await withHint();
    expect(spot()?.getAttribute('role')).toBe('button');
    expect(spot()?.getAttribute('tabindex')).toBe('0');
    expect(spot()?.getAttribute('aria-label')).toBe(
      'Unsicher gelesen: „Schwimbad“ → „Schwimmbad“. Als Fehler übernehmen',
    );
    expect(spot()?.querySelector('line')?.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(spot()?.querySelector('text')).toBeNull();

    tap();
    expect(spot()?.querySelector('text')?.textContent).toBe('„Schwimbad“ → „Schwimmbad“');
    expect(head()).toContain('0 Fehler');

    tap();
    expect(head()).toContain('1 Fehler');
    expect(spot()?.querySelector('line')).toBeNull();
    expect(spot()?.getAttribute('aria-label')).toContain('Wieder als Hinweis zeigen');

    tap();
    expect(head()).toContain('0 Fehler');
    expect(head()).toContain('1 Stelle unsicher gelesen');
    expect(hintItem()).toContain('(unsicher gelesen)');
  });

  it('shows the suggestion on keyboard focus and accepts with Enter', async () => {
    await withHint();
    act(() => {
      spot()?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    expect(spot()?.querySelector('text')?.textContent).toBe('„Schwimbad“ → „Schwimmbad“');
    act(() => {
      spot()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(head()).toContain('1 Fehler');
    act(() => {
      spot()?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(head()).toContain('1 Stelle unsicher gelesen');
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
    const { runner } = await reviewed({ overview: true });
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

  it('shows only the selected arbeit', async () => {
    await reviewed({ arbeitId: 'y' });
    expect(container.querySelector('#arbeit-review-title')?.textContent).toBe('Aufsatz Ben');
    expect(container.querySelectorAll('.review-page')).toHaveLength(1);
  });

  it('calls onSelect with the Arbeit id and marks the selected Arbeit in the class overview', async () => {
    const { arbeiten, flow, runner } = await reviewed();
    const onSelect = vi.fn<(id: string) => void>();
    act(() =>
      root.render(
        <SelectHarness
          flow={flow}
          runner={runner}
          arbeiten={arbeiten}
          selected="x"
          onSelect={onSelect}
        />,
      ),
    );
    expect(buttonNamed('Aufsatz Ada').getAttribute('aria-pressed')).toBe('true');
    expect(buttonNamed('Aufsatz Ben').getAttribute('aria-pressed')).toBe('false');
    act(() => buttonNamed('Aufsatz Ben').click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('y');
  });
});

function labelled(label: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (found === null) throw new Error(`no button ${label}`);
  return found;
}

function controlsOf(label: string): HTMLElement {
  const found = labelled(label).closest<HTMLElement>('.pdf-controls');
  if (found === null) throw new Error(`no controls for ${label}`);
  return found;
}

describe('saving the review as PDF', () => {
  it('saves a fully corrected Arbeit with progress, the save dialog phase and the result', async () => {
    await reviewed({ arbeitId: 'y' });
    const finish = deferred();
    let options: SavePdfOptions = {};
    let outcome: SaveOutcome = { state: 'saved', fileName: 'Aufsatz Ben (korrigiert).pdf' };
    vi.mocked(saveCorrectedPdf).mockImplementation((_arbeit, given = {}) => {
      options = given;
      return finish.promise.then(() => outcome);
    });

    act(() => labelled('Als PDF speichern: Aufsatz Ben').click());
    expect(vi.mocked(saveCorrectedPdf).mock.calls[0]?.[0]).toMatchObject({
      title: 'Aufsatz Ben',
      profile: DEUTSCH,
      statistics: { words: 1, errors: 0 },
    });
    expect(options.footer).toBe(PDF_FOOTER);
    act(() => options.onProgress?.(1, 1));
    const pdfControls = controlsOf('Als PDF speichern: Aufsatz Ben');
    expect(pdfControls.textContent).toContain('Seite 1 von 1');
    expect(pdfControls.textContent).toContain('Abbrechen');

    act(() => options.onPhase?.('saving'));
    expect(pdfControls.textContent).toContain('Speicherort wählen …');
    expect(pdfControls.textContent).not.toContain('Abbrechen');

    await act(async () => {
      finish.resolve();
      await finish.promise;
    });
    expect(pdfControls.querySelector('[role="status"]')?.textContent).toBe(
      'Gespeichert als „Aufsatz Ben (korrigiert).pdf“.',
    );

    outcome = { state: 'failed', reason: 'build' };
    await act(async () => {
      labelled('Als PDF speichern: Aufsatz Ben').click();
      await tick();
    });
    expect(pdfControls.querySelector('[role="status"]')?.textContent).toBe(
      'Das PDF konnte nicht erstellt werden. Bitte die Seiten prüfen und es erneut versuchen.',
    );
  });

  it('cancels building the PDF', async () => {
    await reviewed({ arbeitId: 'y' });
    vi.mocked(saveCorrectedPdf).mockImplementation(
      (_arbeit, given = {}) =>
        new Promise((resolve) => {
          given.signal?.addEventListener('abort', () => resolve({ state: 'cancelled' }));
        }),
    );
    act(() => labelled('Als PDF speichern: Aufsatz Ben').click());
    await act(async () => {
      buttonNamed('Abbrechen').click();
      await tick();
    });
    expect(
      controlsOf('Als PDF speichern: Aufsatz Ben').querySelector('[role="status"]')?.textContent,
    ).toBe('Das Speichern wurde abgebrochen.');
  });

  it('keeps an incomplete Arbeit out and says why', async () => {
    await reviewed();
    expect(labelled('Als PDF speichern: Aufsatz Ada').disabled).toBe(true);
    expect(controlsOf('Als PDF speichern: Aufsatz Ada').textContent).toContain(
      'Als PDF speichern lässt sich die Arbeit erst, wenn alle Seiten berichtigt sind.',
    );
  });

  it('saves the class PDF with the complete Arbeiten only', async () => {
    await reviewed({ overview: true });
    vi.mocked(saveClassPdf).mockResolvedValue({ state: 'cancelled' });
    expect(container.querySelector('.class-overview')?.textContent).toContain(
      '1 Arbeit ist nicht vollständig berichtigt und fehlt im Klassen-PDF.',
    );
    await act(async () => {
      labelled('Klassen-PDF mit Korrekturen speichern').click();
      await tick();
    });
    const [arbeiten, classOptions] = vi.mocked(saveClassPdf).mock.calls.at(-1) ?? [];
    expect(classOptions?.footer).toBe(PDF_FOOTER);
    expect(arbeiten?.map((arbeit) => [arbeit.kind, arbeit.title])).toEqual([
      ['corrected', 'Aufsatz Ben'],
    ]);
    expect(
      controlsOf('Klassen-PDF mit Korrekturen speichern').querySelector('[role="status"]')
        ?.textContent,
    ).toBe('Kein Speicherort gewählt, nichts gespeichert.');
  });

  it('does not save preview corrections', async () => {
    const harness = setupReview(['a']);
    harness.flow.setCorrector(harness.corrector, true);
    await harness.flow.start(harness.pages, DEUTSCH);
    const arbeiten: Arbeit[] = [{ id: 'x', name: 'Aufsatz Ada', pages: harness.pages }];
    act(() =>
      root.render(
        <Harness flow={harness.flow} runner={harness.runner} arbeiten={arbeiten} overview />,
      ),
    );
    expect(labelled('Als PDF speichern: Aufsatz Ada').disabled).toBe(true);
    expect(labelled('Klassen-PDF mit Korrekturen speichern').disabled).toBe(true);
    expect(container.textContent).toContain(
      'Vorschau-Korrekturen werden nicht als PDF gespeichert.',
    );
  });
});
