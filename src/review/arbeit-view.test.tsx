// @vitest-environment happy-dom
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { AppProvider } from '../app/app-context.tsx';
import { testAppModel, testWork } from '../app/test-app.ts';
import type { Navigation, RunController } from '../app/types.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { Runner } from '../pipeline/runner.ts';
import { ArbeitView } from './ArbeitView.tsx';
import { setDisplay } from './display.ts';
import type { ReviewFlow } from './review-flow.ts';
import { readingOf, setupReview, tick, waitFor } from './test-support.ts';

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
  setDisplay('corrected');
});

interface LiveProps {
  readonly flow: ReviewFlow;
  readonly runner: Runner;
  readonly arbeiten: readonly Arbeit[];
  readonly navigation?: Partial<Navigation>;
  readonly run?: Partial<RunController>;
}

function Live({ flow, runner, arbeiten, navigation, run }: LiveProps) {
  const state = useSyncExternalStore(flow.subscribe, flow.getState);
  const runState = useSyncExternalStore(runner.subscribe, runner.getState);
  const model = testAppModel({
    importState: { arbeiten },
    navigation: {
      route: { view: 'arbeit', arbeitId: 'x' },
      position: { index: 0, total: arbeiten.length },
      ...navigation,
    },
    work: testWork({
      count: { runner, state: runState },
      review: { flow, state },
      canRetryCount: true,
      canRetryReview: true,
    }),
    ...(run !== undefined && { run }),
  });
  return (
    <AppProvider value={model}>
      <ArbeitView arbeitId="x" />
    </AppProvider>
  );
}

function show(props: LiveProps) {
  act(() => root.render(<Live {...props} />));
}

const hasExportMenu = () =>
  all('button').some((candidate) => candidate.textContent === 'Exportieren');

async function corrected(props: Partial<LiveProps> = {}) {
  const harness = setupReview(['a', 'b']);
  const [a, b] = harness.pages;
  if (a === undefined || b === undefined) throw new Error('missing pages');
  const arbeiten: Arbeit[] = [
    { id: 'x', name: 'Aufsatz Ada', pages: [a, b] },
    { id: 'y', name: 'Aufsatz Ben', pages: [] },
  ];
  await harness.flow.start(harness.pages, DEUTSCH);
  show({ flow: harness.flow, runner: harness.runner, arbeiten, ...props });
  return { ...harness, arbeiten };
}

async function withHint() {
  const harness = setupReview(['a']);
  const lines = ['Ich war im Schwimbad.', 'Es war schön.'];
  harness.h.transcripts.a = { ok: true, lines, reading: readingOf(lines, { 'Schwimbad.': 0.3 }) };
  await harness.flow.start(harness.pages, DEUTSCH);
  show({
    flow: harness.flow,
    runner: harness.runner,
    arbeiten: [{ id: 'x', name: 'Aufsatz Ada', pages: harness.pages }],
  });
  return harness;
}

async function counted(failing = false) {
  const harness = setupReview(['a', 'b']);
  if (failing) harness.h.transcripts.b = { ok: false, error: { kind: 'failed', message: 'leer' } };
  harness.runner.start();
  await waitFor(() => harness.runner.getState().batch === null);
  show({
    flow: harness.flow,
    runner: harness.runner,
    arbeiten: [{ id: 'x', name: 'Aufsatz Ada', pages: harness.pages }],
  });
  return harness;
}

const query = (selector: string) => container.querySelector<HTMLElement>(selector);
const details = () => container.querySelector<HTMLDetailsElement>('.side-hints');
const editor = () => container.querySelector<HTMLTextAreaElement>('.side-editor textarea');
const all = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const texts = (selector: string) => all(selector).map((element) => element.textContent);

function button(name: string): HTMLButtonElement {
  const found = all('button').find(
    (candidate) => candidate.textContent === name || candidate.getAttribute('aria-label') === name,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no button ${name}`);
  return found;
}

function pointer(element: Element | null, type: 'pointerover' | 'pointerout') {
  if (element === null) throw new Error('no element');
  act(() => {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true }));
  });
}

function key(name: string, target: EventTarget = document.body) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  });
}

function pageMenu(position: number, entry: string) {
  const trigger = all('.sheet-menu button')[position - 1];
  if (trigger === undefined) throw new Error(`no menu for page ${position}`);
  act(() => trigger.click());
  const item = all('[role=menuitem]').find((candidate) => candidate.textContent === entry);
  if (item === undefined) throw new Error(`no entry ${entry}`);
  return item;
}

function choose(position: number, entry: string) {
  const item = pageMenu(position, entry);
  act(() => item.click());
}

function enter(area: HTMLTextAreaElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  act(() => {
    descriptor?.set?.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the head of an Arbeit', () => {
  it('names the Arbeit, its position and its figures', async () => {
    await corrected();
    expect(query('h1')?.textContent).toBe('Aufsatz Ada');
    expect(query('.detail-position')?.textContent).toBe('1 von 2');
    expect(query('.detail-figures')?.textContent).toBe('10 Wörter · 1 Fehler');
    expect(query('.detail-figures')?.title).toBe('1 gewichtete Fehler · Fehlerquotient 10,0');
    expect(button('Vorherige Arbeit').disabled).toBe(true);
    expect(button('Nächste Arbeit').disabled).toBe(false);
  });

  it('offers its own export menu only while the header does not', async () => {
    const harness = await corrected({ run: { running: true } });
    expect(button('Exportieren')).toBeDefined();
    const { flow, runner, arbeiten } = harness;
    show({ flow, runner, arbeiten, run: { done: { correct: true, count: false } } });
    expect(hasExportMenu()).toBe(false);
    show({ flow, runner, arbeiten, run: { done: { correct: false, count: false } } });
    expect(hasExportMenu()).toBe(false);
  });

  it('switches between the corrected and the original pages for every Arbeit', async () => {
    const harness = await corrected();
    expect(all('.annotated-page')).toHaveLength(2);
    act(() => button('Original').click());
    expect(all('.annotated-page')).toHaveLength(0);
    expect(all('.sheet-paper img')).toHaveLength(2);

    act(() => root.unmount());
    root = createRoot(container);
    show({ flow: harness.flow, runner: harness.runner, arbeiten: harness.arbeiten });
    expect(query('[role=radio][aria-checked=true]')?.textContent).toBe('Original');
    expect(all('.annotated-page')).toHaveLength(0);
  });
});

describe('the keyboard', () => {
  it('steps through the Arbeiten with the arrow keys and goes back with Escape', async () => {
    const next = vi.fn<() => void>();
    const prev = vi.fn<() => void>();
    const back = vi.fn<() => void>();
    await corrected({ navigation: { next, prev, back } });
    key('ArrowRight');
    key('ArrowLeft');
    key('Escape');
    expect(next).toHaveBeenCalledOnce();
    expect(prev).toHaveBeenCalledOnce();
    expect(back).toHaveBeenCalledOnce();
  });

  it('leaves the keys to text fields and open menus', async () => {
    const next = vi.fn<() => void>();
    const back = vi.fn<() => void>();
    await corrected({ navigation: { next, back } });
    choose(1, 'Text bearbeiten');
    const area = container.querySelector('textarea');
    if (area === null) throw new Error('no editor');
    key('ArrowRight', area);
    key('Escape', area);
    expect(next).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(query('textarea')).toBeNull();

    pageMenu(1, 'Text bearbeiten');
    const menu = query('[role=menu]');
    if (menu === null) throw new Error('no menu');
    key('ArrowRight', menu);
    key('Escape', menu);
    expect(next).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });
});

function stubScroll() {
  const scrolled: (number | undefined)[] = [];
  const rects = new Map<Element, DOMRect>();
  const rect = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function measure(this: Element) {
      return rects.get(this) ?? new DOMRect(0, 0, 0, 0);
    });
  const scrollBy = vi
    .spyOn(window, 'scrollBy')
    .mockImplementation((options?: ScrollToOptions | number) => {
      scrolled.push(typeof options === 'object' ? options.top : undefined);
    });
  return {
    scrolled,
    place: (element: Element | null, top: number, height: number) => {
      if (element !== null) rects.set(element, new DOMRect(0, top, 100, height));
    },
    restore: () => {
      rect.mockRestore();
      scrollBy.mockRestore();
    },
  };
}

describe('the errors next to the pages', () => {
  it('lists the errors of every page', async () => {
    await corrected();
    expect(texts('.side-page-head')).toEqual(['Seite 11 Fehler', 'Seite 20 Fehler']);
    expect(texts('.side-mark')).toEqual(['R„Schwimbad“ → „Schwimmbad“']);
    expect(query('.side-mark')?.getAttribute('aria-label')).toBe(
      'Rechtschreibung: „Schwimbad“ → „Schwimmbad“',
    );
    expect(texts('.side-empty')).toEqual(['Keine Fehler']);
  });

  it('highlights a mark on the page while its entry is hovered and the other way round', async () => {
    await corrected();
    const entry = query('.side-mark');
    pointer(entry, 'pointerover');
    expect(query('.annotated-page')?.getAttribute('data-active')).toBe('1:0');
    expect(query('.annotated-page__mark.is-active')?.getAttribute('data-mark-key')).toBe('1:0');
    pointer(entry, 'pointerout');
    expect(query('.annotated-page')?.hasAttribute('data-active')).toBe(false);

    pointer(query('.annotated-page__mark'), 'pointerover');
    expect(query('.side-mark')?.classList.contains('is-active')).toBe(true);
    pointer(query('.annotated-page__mark'), 'pointerout');
    expect(query('.side-mark')?.classList.contains('is-active')).toBe(false);
  });
});

describe('revealing a place on the page', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('scrolls the mark of a clicked error to the middle and highlights it for a moment', async () => {
    await corrected();
    const scroll = stubScroll();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
      scroll.place(query('.detail-head'), 0, 100);
      scroll.place(query('.annotated-page [data-mark-key]'), 1900, 20);
      act(() => query('.side-mark')?.click());
      expect(scroll.scrolled).toEqual([1910 - 550]);
      expect(query('.annotated-page__mark.is-active')?.getAttribute('data-mark-key')).toBe('1:0');
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(query('.annotated-page__mark.is-active')).toBeNull();
    } finally {
      scroll.restore();
    }
  });

  it('scrolls to the page when the mark is not drawn', async () => {
    await corrected();
    const scroll = stubScroll();
    try {
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
      for (const mark of all('.annotated-page__mark')) mark.remove();
      scroll.place(query('.sheet'), 3000, 400);
      act(() => query('.side-mark')?.click());
      expect(scroll.scrolled).toEqual([3200 - 500]);
    } finally {
      scroll.restore();
    }
  });

  it('scrolls an uncertain reading to the middle and highlights it when its entry is clicked', async () => {
    await withHint();
    const scroll = stubScroll();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
      scroll.place(query('.annotated-page .hint-spot'), 2000, 40);
      act(() => {
        const group = details();
        if (group !== null) group.open = true;
        group?.dispatchEvent(new Event('toggle'));
      });
      act(() => query('.side-hint-text')?.click());
      expect(scroll.scrolled).toEqual([2020 - 500]);
      expect(query('.hint-spot')?.hasAttribute('data-selected')).toBe(true);
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(query('.hint-spot')?.hasAttribute('data-selected')).toBe(false);
    } finally {
      scroll.restore();
    }
  });
});

const summary = () => query('.side-hints summary')?.textContent;
const hintState = () => query('.side-hint')?.textContent;

describe('uncertain readings', () => {
  it('are dotted on the page and collapsed in the column', async () => {
    await withHint();
    expect(query('.hint-spot line')?.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(summary()).toBe('1 unsicher gelesen');
    expect(details()?.open).toBe(false);
    expect(query('.side-page-figure')?.textContent).toBe('0 Fehler');
  });

  it('opens the entry when the place on the page is clicked', async () => {
    await withHint();
    act(() => {
      query('.hint-spot')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(tick);
    expect(details()?.open).toBe(true);
    expect(document.activeElement?.textContent).toBe('Übernehmen');
  });

  it('can be taken over, discarded and both undone', async () => {
    await withHint();
    act(() => button('Übernehmen: „Schwimbad“ → „Schwimmbad“').click());
    expect(query('.side-page-figure')?.textContent).toBe('1 Fehler');
    expect(texts('.side-mark')).toEqual(['R„Schwimbad“ → „Schwimmbad“']);
    expect(hintState()).toContain('übernommen');
    expect(summary()).toBe('1 unsicher gelesen, geprüft');
    expect(query('.hint-spot')).toBeNull();

    act(() => button('Rückgängig: „Schwimbad“ → „Schwimmbad“').click());
    expect(query('.side-page-figure')?.textContent).toBe('0 Fehler');
    expect(query('.hint-spot')).not.toBeNull();

    act(() => button('Verwerfen: „Schwimbad“ → „Schwimmbad“').click());
    expect(hintState()).toContain('verworfen');
    expect(query('.hint-spot')).toBeNull();
    expect(query('.side-page-figure')?.textContent).toBe('0 Fehler');

    act(() => button('Rückgängig: „Schwimbad“ → „Schwimmbad“').click());
    expect(summary()).toBe('1 unsicher gelesen');
  });
});

describe('editing the text of a page', () => {
  it('updates the words and leaves the page open for the next run', async () => {
    const { flow } = await corrected();
    choose(1, 'Text bearbeiten');
    const area = editor();
    if (area === null) throw new Error('no editor');
    expect(document.activeElement).toBe(area);
    expect(area.value).toBe('Ich war im Schwimbad.\nEs war schön.');

    enter(area, 'Ich war im Schwimbad.\nEs war schön.\nEnde.');
    expect(query('.side-words')?.textContent).toBe('8 Wörter');
    act(() => button('Fertig').click());
    expect(query('.side-page-figure')?.textContent).toBe('offen');
    expect(all('.annotated-page')).toHaveLength(1);
    expect(flow.getState().pages.a?.source).toBe('Ich war im Schwimbad.\nEs war schön.');
  });

  it('asks before recognising an edited page again and corrects it afterwards', async () => {
    const { h, runner } = await corrected();
    choose(1, 'Text bearbeiten');
    const area = editor();
    if (area === null) throw new Error('no editor');
    enter(area, 'Geändert.');
    act(() => button('Fertig').click());

    h.log.length = 0;
    choose(1, 'Neu erkennen');
    expect(query('dialog[open]')?.textContent).toContain(
      'Die Änderungen am Text von Seite 1 gehen verloren.',
    );
    expect(h.log).toEqual([]);
    await act(async () => {
      button('Neu erkennen').click();
      await waitFor(() => h.log.includes('C:Ich war im Schwimbad.'));
    });
    expect(h.log[0]).toBe('T:a');
    expect(runner.getState().entries.a?.edited).toBe(false);
  });

  it('recognises an unedited page again without asking', async () => {
    const { h } = await corrected();
    h.log.length = 0;
    choose(2, 'Neu erkennen');
    await act(() => waitFor(() => h.log.includes('C:Wir gingen heim.')));
    expect(query('dialog[open]')).toBeNull();
    expect(h.log[0]).toBe('T:b');
  });

  it('is locked during a run', async () => {
    await corrected({ run: { running: true } });
    const entry = pageMenu(1, 'Text bearbeiten');
    expect(entry.getAttribute('aria-disabled')).toBe('true');
    expect(entry.getAttribute('title')).toBe('Erst nach dem Lauf möglich');
  });
});

describe('an Arbeit whose words were only counted', () => {
  it('shows the recognised text with the words of each page', async () => {
    await counted();
    expect(texts('.side-page-head')).toEqual(['Seite 17 Wörter', 'Seite 23 Wörter']);
    expect(texts('.side-text')).toEqual([
      'Ich war im Schwimbad.\nEs war schön.',
      'Wir gingen heim.',
    ]);
    expect(query('.detail-figures')?.textContent).toBe('10 Wörter');
    expect(all('[role=radiogroup]')).toHaveLength(0);
  });

  it('marks a partial count and offers to retry the failed page at the page', async () => {
    const { h, runner } = await counted(true);
    expect(query('.detail-figures')?.textContent).toBe('mind. 7 Wörter');
    expect(query('.sheet-problem')?.textContent).toContain('Die Seite konnte nicht erkannt werden');
    h.transcripts.b = { ok: true, lines: ['Wir gingen heim.'] };
    await act(async () => {
      button('Erneut versuchen').click();
      await waitFor(() => runner.getState().entries.b?.status === 'done');
    });
    expect(query('.detail-figures')?.textContent).toBe('10 Wörter');
    expect(query('.sheet-problem')).toBeNull();
  });
});
