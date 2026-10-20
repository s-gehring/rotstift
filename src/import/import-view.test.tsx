// @vitest-environment happy-dom
import { act, useEffect, useMemo, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { arbeitenReducer, flattenPages, type Arbeit } from './arbeiten.ts';
import { ImportView } from './ImportView.tsx';
import type { ImportPage } from './pages.ts';
import type { useImportPages } from './use-import-pages.ts';

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

const start: readonly Arbeit[] = [
  { id: 'anna', name: 'Anna', pages: [page('a1'), page('a2')] },
  { id: 'ben', name: 'Ben', pages: [page('b1')] },
  { id: 'cleo', name: 'Cleo', pages: [page('c1')] },
];

let latest: readonly Arbeit[] = [];

function record(arbeiten: readonly Arbeit[]) {
  latest = arbeiten;
}

function Harness({ onChange }: { readonly onChange: (arbeiten: readonly Arbeit[]) => void }) {
  const [arbeiten, dispatch] = useReducer(arbeitenReducer, start);
  useEffect(() => {
    onChange(arbeiten);
  }, [arbeiten, onChange]);
  const pages = useMemo(() => flattenPages(arbeiten), [arbeiten]);
  const importState: ReturnType<typeof useImportPages> = {
    arbeiten,
    pages,
    dispatch,
    addFiles: () => undefined,
    busy: false,
    notices: [],
    dismissNotices: () => undefined,
  };
  return <ImportView importState={importState} />;
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Harness onChange={record} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const names = () => latest.map((arbeit) => `${arbeit.name}:${arbeit.pages.length}`);

function control(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (found === null) throw new Error(`Kein Element mit dem Namen „${label}“`);
  return found;
}

function setValue(field: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype.prototype, 'value');
  act(() => {
    descriptor?.set?.call(field, value);
    field.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

function selectControl(label: string): HTMLSelectElement {
  const found = control(label);
  if (!(found instanceof HTMLSelectElement)) throw new Error(`„${label}“ ist keine Auswahl`);
  return found;
}

const mergeButton = () =>
  [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Ausgewählte zusammenführen',
  );

describe('Arbeiten in the import view', () => {
  it('lists every Arbeit with its name and page count', () => {
    const inputs = [...container.querySelectorAll<HTMLInputElement>('.arbeit-name')];
    expect(inputs.map((field) => field.value)).toEqual(['Anna', 'Ben', 'Cleo']);
    expect(container.querySelector('.list-header p')?.textContent).toBe('3 Arbeiten · 4 Seiten');
  });

  it('renames an Arbeit inline when the field loses focus', () => {
    const [field] = container.querySelectorAll<HTMLInputElement>('.arbeit-name');
    if (field === undefined) throw new Error('Kein Namensfeld');
    setValue(field, 'Anna Schmidt');
    act(() => {
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(names()).toEqual(['Anna Schmidt:2', 'Ben:1', 'Cleo:1']);
  });

  it('keeps the old name when the new one is empty', () => {
    const [field] = container.querySelectorAll<HTMLInputElement>('.arbeit-name');
    if (field === undefined) throw new Error('Kein Namensfeld');
    setValue(field, '  ');
    act(() => {
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(names()[0]).toBe('Anna:2');
    expect(field.value).toBe('Anna');
  });

  it('needs two selected Arbeiten before it merges', () => {
    expect(mergeButton()?.disabled).toBe(true);
    act(() => control('Ben zum Zusammenführen auswählen').click());
    expect(mergeButton()?.disabled).toBe(true);
    act(() => control('Cleo zum Zusammenführen auswählen').click());
    expect(mergeButton()?.disabled).toBe(false);
    act(() => mergeButton()?.click());
    expect(names()).toEqual(['Anna:2', 'Ben:2']);
    expect(container.querySelector('[role=status]')?.textContent).toBe(
      '2 Arbeiten zu „Ben“ zusammengeführt.',
    );
  });

  it('moves a page into another Arbeit and drops the emptied one', () => {
    const select = selectControl('Seite 1 von Ben in eine andere Arbeit verschieben');
    setValue(select, 'anna');
    expect(names()).toEqual(['Anna:3', 'Cleo:1']);
  });

  it('splits a page of a multi-page Arbeit off into its own Arbeit', () => {
    const select = selectControl('Seite 2 von Anna in eine andere Arbeit verschieben');
    setValue(select, 'new');
    expect(names()).toEqual(['Anna:1', 'Anna (Seite 2):1', 'Ben:1', 'Cleo:1']);
  });

  it('offers no split for the only page of an Arbeit', () => {
    const select = selectControl('Seite 1 von Ben in eine andere Arbeit verschieben');
    expect([...select.options].map((option) => option.value)).toEqual(['', 'anna', 'cleo']);
  });

  it('removes a whole Arbeit', () => {
    act(() => control('Ben entfernen').click());
    expect(names()).toEqual(['Anna:2', 'Cleo:1']);
  });

  it('keeps rotating and removing pages', () => {
    act(() => control('Seite 1 von Ben nach rechts drehen').click());
    expect(latest[1]?.pages[0]?.rotation).toBe(90);
    act(() => control('Seite 1 von Ben entfernen').click());
    expect(names()).toEqual(['Anna:2', 'Cleo:1']);
  });
});
