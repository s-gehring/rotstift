// @vitest-environment happy-dom
import { act, useEffect, useMemo, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProvider } from '../app/app-context.tsx';
import { testAppModel, testCloud, testToasts, testWork } from '../app/test-app.ts';
import type { ImportPages, Models, RunController } from '../app/types.ts';
import type { ToastOptions } from '../ui/Toast.tsx';
import { flattenPages, type Arbeit } from './arbeiten.ts';
import { INITIAL_IMPORT_STATE, importReducer, type ImportState } from './import-state.ts';
import { KlasseView } from './KlasseView.tsx';
import type { ImportPage } from './pages.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function page(id: string): ImportPage {
  return {
    id,
    fileKey: id,
    label: `${id}.png`,
    source: { kind: 'image', file: new File([], `${id}.png`) },
    width: 10,
    height: 10,
    rotation: 0,
    thumbnailUrl: `blob:${id}`,
  };
}

const start: ImportState = {
  ...INITIAL_IMPORT_STATE,
  arbeiten: [
    { id: 'anna', name: 'Anna', pages: [page('a1'), page('a2'), page('a3')] },
    { id: 'ben', name: 'Ben', pages: [page('b1')] },
    { id: 'cleo', name: 'Cleo', pages: [page('c1')] },
  ],
};

interface ToastCall {
  readonly text: string;
  readonly options: ToastOptions | undefined;
}

const seen: { arbeiten: readonly Arbeit[] } = { arbeiten: [] };
let toastCalls: ToastCall[] = [];
let added: File[][] = [];
let opened: string[] = [];
const openOverview = vi.fn<() => void>();

function Harness({
  initial = start,
  run = {},
  withResults = false,
  models,
}: {
  readonly initial?: ImportState;
  readonly run?: Partial<RunController>;
  readonly withResults?: boolean;
  readonly models?: Partial<Models>;
}) {
  const [state, dispatch] = useReducer(importReducer, initial);
  useEffect(() => {
    seen.arbeiten = state.arbeiten;
  }, [state.arbeiten]);
  const pages = useMemo(() => flattenPages(state.arbeiten), [state.arbeiten]);
  const importState: ImportPages = {
    arbeiten: state.arbeiten,
    pages,
    dispatch,
    addFiles: (files) => added.push([...files]),
    busy: false,
    undo: () => dispatch({ type: 'undo' }),
  };
  const work = testWork();
  if (withResults) {
    work.count.state = {
      ...work.count.state,
      entries: {
        a1: {
          status: 'done',
          text: 'eins zwei drei',
          hasTranscript: true,
          edited: false,
          rotation: 0,
          error: null,
          reading: null,
        },
      },
    };
  }
  const model = testAppModel({
    importState,
    run,
    models,
    work,
    toasts: testToasts({
      show: (text, options) => toastCalls.push({ text, options }),
    }),
    navigation: {
      openArbeit: (id) => opened.push(id),
      openOverview,
    },
  });
  return (
    <AppProvider value={model}>
      <KlasseView />
    </AppProvider>
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  seen.arbeiten = [];
  toastCalls = [];
  added = [];
  opened = [];
  openOverview.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: Parameters<typeof Harness>[0] = {}) {
  act(() => root.render(<Harness {...props} />));
}

const names = () => seen.arbeiten.map((arbeit) => `${arbeit.name}:${arbeit.pages.length}`);
const announcement = () => container.querySelector('[role=status].sr-only')?.textContent;

function control(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (found === null) throw new Error(`Kein Element mit dem Namen „${label}“`);
  return found;
}

function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error('Element fehlt');
  act(() => element.click());
}

function hover(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
}

const item = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (entry) => entry.textContent === label,
  );

function hoverItem(label: string) {
  const entry = item(label);
  if (entry === undefined) throw new Error(`Kein Menüpunkt „${label}“`);
  hover(entry);
}

function menuAction(trigger: string, ...path: string[]) {
  click(control(trigger));
  path.forEach((label, index) => {
    const entry = item(label);
    if (index < path.length - 1) hoverItem(label);
    else click(entry);
  });
}

describe('empty Klasse', () => {
  it('shows only the drop area', () => {
    render({ initial: INITIAL_IMPORT_STATE });
    expect(container.textContent).toBe(
      'Arbeiten hierher ziehenDateien auswählenPDF oder Bilder. Alles bleibt auf diesem Rechner.',
    );
  });

  it('says when cloud models send data to third parties', () => {
    render({
      initial: INITIAL_IMPORT_STATE,
      models: {
        cloud: testCloud({
          steps: {
            transcriber: {
              template: 'mistral',
              label: 'Mistral AI',
              baseUrl: 'https://api.mistral.ai/v1',
              host: 'api.mistral.ai',
              model: 'pixtral-12b',
              loopback: false,
              confirmed: true,
              key: 'system',
            },
          },
        }),
      },
    });
    expect(container.querySelector('.klasse-drop-note')?.textContent).toBe(
      'PDF oder Bilder. Cloud-Modelle senden Daten an Drittanbieter.',
    );
  });

  it('hands picked files to the import', () => {
    render({ initial: INITIAL_IMPORT_STATE });
    const file = new File([], 'a.png');
    const input = container.querySelector<HTMLInputElement>('[data-testid=file-input]');
    if (input === null) throw new Error('Kein Datei-Feld');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(added).toEqual([[file]]);
  });
});

describe('list of Arbeiten', () => {
  it('summarizes Arbeiten and pages and lists a row per Arbeit', () => {
    render();
    expect(container.querySelector('.klasse-summary')?.textContent).toBe('3 Arbeiten · 5 Seiten');
    expect([...container.querySelectorAll('.arbeit-name')].map((n) => n.textContent)).toEqual([
      'Anna',
      'Ben',
      'Cleo',
    ]);
    expect(container.querySelector('input[type=checkbox]')).toBeNull();
  });

  it('opens an Arbeit only after a run produced results', () => {
    render();
    expect(container.querySelector('button.arbeit-name')).toBeNull();
    expect(container.textContent).not.toContain('Übersicht');
    render({ withResults: true });
    click(container.querySelector('button.arbeit-name'));
    expect(container.textContent).toContain('Übersicht');
    click([...container.querySelectorAll('button')].find((b) => b.textContent === 'Übersicht'));
    expect(openOverview).toHaveBeenCalledTimes(1);
  });

  it('hides the overview link while a run is active', () => {
    render({ withResults: true, run: { running: true } });
    expect(container.textContent).not.toContain('Übersicht');
  });

  it('shows words of a partly counted Arbeit as a lower bound', () => {
    render({ withResults: true });
    expect(container.querySelector('.arbeit-figures')?.textContent).toBe('mind. 3 Wörter');
  });

  it('renames through the menu', () => {
    render();
    menuAction('Weitere Aktionen für Ben', 'Umbenennen');
    const field = container.querySelector<HTMLInputElement>('.arbeit-name-field');
    if (field === null) throw new Error('Kein Namensfeld');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        field,
        '  Benjamin ',
      );
    });
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(names()).toEqual(['Anna:3', 'Benjamin:1', 'Cleo:1']);
    expect(container.querySelector('.arbeit-name-field')).toBeNull();
  });

  it('renames on double click and keeps the name on Escape', () => {
    render();
    act(() => {
      container
        .querySelectorAll('.arbeit-name')[0]
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const field = container.querySelector('.arbeit-name-field');
    if (field === null) throw new Error('Kein Namensfeld');
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(names()[0]).toBe('Anna:3');
    expect(container.querySelector('.arbeit-name-field')).toBeNull();
  });

  it('merges two Arbeiten through the menu and announces it', () => {
    render();
    menuAction('Weitere Aktionen für Cleo', 'Zusammenführen mit', 'Anna');
    expect(names()).toEqual(['Anna:4', 'Ben:1']);
    expect(announcement()).toBe('Cleo und Anna zu „Anna“ zusammengeführt.');
  });

  it('offers no merge target when there is only one Arbeit', () => {
    render({ initial: { ...start, arbeiten: start.arbeiten.slice(0, 1) } });
    click(control('Weitere Aktionen für Anna'));
    expect(item('Zusammenführen mit')?.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('removing with undo', () => {
  it('removes an Arbeit without asking and offers undo', () => {
    render();
    menuAction('Weitere Aktionen für Ben', 'Entfernen');
    expect(names()).toEqual(['Anna:3', 'Cleo:1']);
    expect(toastCalls.map((call) => call.text)).toEqual(['Ben entfernt']);
    act(() => toastCalls[0]?.options?.action?.onAction());
    expect(names()).toEqual(['Anna:3', 'Ben:1', 'Cleo:1']);
    expect(announcement()).toBe('Entfernen rückgängig gemacht.');
  });

  it('removes a page, then restores it at its place', () => {
    render();
    menuAction('Weitere Aktionen für Seite 2 von Anna', 'Entfernen');
    expect(names()).toEqual(['Anna:2', 'Ben:1', 'Cleo:1']);
    expect(announcement()).toBe('Seite 2 von Anna entfernt. 2 Seiten übrig.');
    expect(toastCalls[0]?.text).toBe('Seite 2 entfernt');
    act(() => toastCalls[0]?.options?.action?.onAction());
    expect(seen.arbeiten[0]?.pages.map((p) => p.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('names the Arbeit when removing its only page', () => {
    render();
    menuAction('Weitere Aktionen für Seite 1 von Ben', 'Entfernen');
    expect(names()).toEqual(['Anna:3', 'Cleo:1']);
    expect(toastCalls[0]?.text).toBe('Ben entfernt');
  });

  it('clears everything and restores it', () => {
    render();
    menuAction('Weitere Aktionen für die Klasse', 'Alle entfernen');
    expect(seen.arbeiten).toEqual([]);
    expect(container.textContent).toContain('Arbeiten hierher ziehen');
    act(() => toastCalls[0]?.options?.action?.onAction());
    expect(names()).toEqual(['Anna:3', 'Ben:1', 'Cleo:1']);
  });
});

describe('page actions', () => {
  it('rotates, moves and splits pages through the menu', () => {
    render();
    menuAction('Weitere Aktionen für Seite 1 von Anna', 'Rechts drehen');
    expect(seen.arbeiten[0]?.pages[0]?.rotation).toBe(90);
    menuAction('Weitere Aktionen für Seite 1 von Anna', 'Nach hinten');
    expect(seen.arbeiten[0]?.pages.map((p) => p.id)).toEqual(['a2', 'a1', 'a3']);
    expect(announcement()).toBe('Seite 1 von Anna steht jetzt an Position 2 von 3.');
    menuAction('Weitere Aktionen für Seite 2 von Anna', 'Nach vorn');
    expect(seen.arbeiten[0]?.pages.map((p) => p.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('rotates with the button on the preview', () => {
    render();
    click(control('Seite 2 von Anna drehen'));
    expect(seen.arbeiten[0]?.pages[1]?.rotation).toBe(90);
  });

  it('moves a page into another Arbeit and drops the emptied one', () => {
    render();
    menuAction('Weitere Aktionen für Seite 1 von Ben', 'In andere Arbeit', 'Anna');
    expect(names()).toEqual(['Anna:4', 'Cleo:1']);
  });

  it('moves a page into a new Arbeit', () => {
    render();
    menuAction('Weitere Aktionen für Seite 2 von Anna', 'In andere Arbeit', 'Neue Arbeit');
    expect(names()).toEqual(['Anna:2', 'Anna (Seite 2):1', 'Ben:1', 'Cleo:1']);
  });

  it('offers no new Arbeit for the only page of an Arbeit', () => {
    render();
    click(control('Weitere Aktionen für Seite 1 von Ben'));
    hoverItem('In andere Arbeit');
    const targets = [...document.querySelectorAll('.submenu [role=menuitem]')].map(
      (entry) => entry.textContent,
    );
    expect(targets).toEqual(['Anna', 'Cleo']);
  });

  it('starts a new Arbeit from this page on', () => {
    render();
    menuAction('Weitere Aktionen für Seite 2 von Anna', 'Ab hier neue Arbeit');
    expect(names()).toEqual(['Anna:1', 'Anna (ab Seite 2):2', 'Ben:1', 'Cleo:1']);
    expect(announcement()).toBe('Ab Seite 2 von Anna ist jetzt eine neue Arbeit mit 2 Seiten.');
  });

  it('cannot split before the first page', () => {
    render();
    click(control('Weitere Aktionen für Seite 1 von Anna'));
    expect(item('Ab hier neue Arbeit')?.getAttribute('aria-disabled')).toBe('true');
    expect(item('Nach vorn')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('enlarges a page in a dialog', () => {
    render();
    click(control('Seite 1 von Ben vergrößern'));
    expect(document.querySelector('dialog h2')?.textContent).toBe('Ben, Seite 1');
  });

  it('moves a dragged page onto another page', () => {
    render();
    const target = container.querySelector('[data-page-id="a1"]');
    const data = new Map([['application/x-rotstift-page', 'c1']]);
    const transfer = {
      types: ['application/x-rotstift-page'],
      getData: (type: string) => data.get(type) ?? '',
      dropEffect: '',
    };
    act(() => {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.assign(event, { dataTransfer: transfer });
      target?.dispatchEvent(event);
    });
    expect(names()).toEqual(['Anna:4', 'Ben:1']);
    expect(seen.arbeiten[0]?.pages.map((p) => p.id)).toEqual(['c1', 'a1', 'a2', 'a3']);
  });
});

describe('while a run is active', () => {
  it('greys out loading, removing and sorting but keeps the menus reachable', () => {
    render({ run: { running: true } });
    const disabled = (trigger: string, ...labels: string[]) => {
      click(control(trigger));
      const states = labels.map((label) => item(label)?.getAttribute('aria-disabled'));
      click(control(trigger));
      return states;
    };
    expect(
      disabled('Weitere Aktionen für die Klasse', 'Dateien hinzufügen', 'Alle entfernen'),
    ).toEqual(['true', 'true']);
    expect(disabled('Weitere Aktionen für Ben', 'Zusammenführen mit', 'Entfernen')).toEqual([
      'true',
      'true',
    ]);
    expect(
      disabled(
        'Weitere Aktionen für Seite 2 von Anna',
        'Rechts drehen',
        'Nach hinten',
        'Entfernen',
      ),
    ).toEqual(['true', 'true', 'true']);
    expect(control('Seite 2 von Anna drehen').hasAttribute('disabled')).toBe(true);
    expect(container.querySelector('[data-page-id="a1"]')?.getAttribute('draggable')).toBe('false');
  });
});
