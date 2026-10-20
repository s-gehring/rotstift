// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENGLISCH } from '../annotations/profile.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import { page } from '../review/test-support.ts';
import { AppProvider } from './app-context.tsx';
import { Header } from './Header.tsx';
import { testAppModel, type TestAppParts } from './test-app.ts';
import type { RunController, Subject } from './types.ts';

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

const arbeiten: Arbeit[] = [{ id: 'x', name: 'Aufsatz', pages: [page('a'), page('b')] }];

function render(parts: TestAppParts) {
  act(() =>
    root.render(
      <AppProvider value={testAppModel({ importState: { arbeiten }, ...parts })}>
        <Header />
      </AppProvider>,
    ),
  );
}

const button = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (candidate) =>
      candidate.textContent === label || candidate.getAttribute('aria-label') === label,
  );
const labels = () => [...container.querySelectorAll('button')].map((b) => b.textContent);
const subject = () => container.querySelector('select');

function click(element: Element | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error('missing button');
  act(() => element.click());
}

function menuItem(label: string) {
  return [...document.querySelectorAll('[role="menuitem"]')].find(
    (item) => item.textContent === label,
  );
}

describe('Header', () => {
  it('shows only the name and the settings while no Arbeit is loaded', () => {
    const show = vi.fn<() => void>();
    render({
      importState: { arbeiten: [] },
      models: { settings: { open: false, show, close: vi.fn<() => void>() } },
    });
    expect(container.querySelector('.app-title')?.textContent).toBe('Rotstift');
    expect(labels()).toEqual(['']);
    expect(container.querySelector('.demo-tag')).toBeNull();
    click(button('Einstellungen'));
    expect(show).toHaveBeenCalledOnce();
  });

  it('marks the demo mode', () => {
    render({ demo: true });
    expect(container.querySelector('.demo-tag')?.textContent).toBe('Demo');
  });

  it('offers the subject and Korrigieren, with word counting behind the arrow', () => {
    const start = vi.fn<RunController['start']>();
    render({ run: { start } });
    expect(subject()?.closest('label')?.textContent).toContain('Fach');
    expect([...(subject()?.options ?? [])].map((option) => option.textContent)).toEqual([
      'Deutsch',
      'Englisch',
      'Französisch',
      'Spanisch',
      'Sachfach',
    ]);
    click(button('Korrigieren'));
    expect(start).toHaveBeenCalledWith();
    click(button('Weitere Möglichkeiten'));
    click(menuItem('Nur Wörter zählen'));
    expect(start).toHaveBeenLastCalledWith('count');
  });

  it('keeps the last chosen kind as the main action', () => {
    const start = vi.fn<RunController['start']>();
    render({ run: { kind: 'count', start } });
    expect(subject()).toBeNull();
    click(button('Wörter zählen'));
    expect(start).toHaveBeenCalledWith();
    click(button('Weitere Möglichkeiten'));
    click(menuItem('Korrigieren'));
    expect(start).toHaveBeenLastCalledWith('correct');
  });

  it('changes the subject', () => {
    const select = vi.fn<Subject['select']>();
    render({ subject: { select } });
    const field = subject();
    if (field === null) throw new Error('missing select');
    act(() => {
      field.value = 'englisch';
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(select).toHaveBeenCalledWith(ENGLISCH);
  });

  it('disables the main action while the models are checked or unavailable', () => {
    render({ run: { checking: true } });
    expect(button('Korrigieren')?.disabled).toBe(true);
    render({ run: { unavailable: 'Die Korrektur steht nur in der Desktop-App zur Verfügung.' } });
    expect(button('Korrigieren')?.disabled).toBe(true);
  });

  it('shows the progress in the middle and offers to cancel while running', () => {
    const cancel = vi.fn<() => void>();
    render({
      run: {
        running: true,
        cancel,
        progress: { label: 'Seite 12 von 61', detail: 'noch etwa 3 Minuten', value: 11, max: 61 },
      },
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Seite 12 von 61noch etwa 3 Minuten',
    );
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('11');
    expect(bar?.getAttribute('aria-valuemax')).toBe('61');
    expect(bar?.getAttribute('aria-valuetext')).toBe('Seite 12 von 61 · noch etwa 3 Minuten');
    expect(button('Korrigieren')).toBeUndefined();
    expect(subject()).toBeNull();
    click(button('Abbrechen'));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('greys out the cancel button while stopping', () => {
    render({
      run: {
        running: true,
        stopping: true,
        progress: { label: 'Wird abgebrochen …', detail: null, value: null, max: 1 },
      },
    });
    expect(button('Abbrechen')?.disabled).toBe(true);
    expect(container.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(
      false,
    );
  });

  it('offers the export once everything is done', () => {
    render({ run: { done: { count: true, correct: true } } });
    expect(button('Exportieren')?.className).toContain('btn-primary');
    expect(button('Korrigieren')).toBeUndefined();
    expect(subject()).toBeNull();
  });

  it('still offers Korrigieren next to the export after counting only', () => {
    const start = vi.fn<RunController['start']>();
    render({ run: { kind: 'count', done: { count: true, correct: false }, start } });
    expect(button('Exportieren')).toBeDefined();
    expect(subject()).not.toBeNull();
    expect(button('Korrigieren')?.className).toContain('btn-secondary');
    click(button('Korrigieren'));
    expect(start).toHaveBeenCalledWith('correct');
  });

  it('runs only for the open pages again when new pages arrive', () => {
    render({ run: { done: { count: false, correct: false } } });
    expect(button('Korrigieren')).toBeDefined();
    expect(button('Exportieren')).toBeUndefined();
  });
});
