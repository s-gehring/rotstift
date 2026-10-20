// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TOAST_ACTION_DURATION_MS,
  TOAST_DURATION_MS,
  ToastRegion,
  useToast,
  type Toasts,
} from './Toast.tsx';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;
let toasts: Toasts | null = null;

function Harness() {
  const value = useToast();
  useEffect(() => {
    toasts = value;
  });
  return <ToastRegion toasts={value} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const region = () => container.querySelector('[role="status"]');
const button = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (candidate) =>
      candidate.textContent === label || candidate.getAttribute('aria-label') === label,
  );

function show(...args: Parameters<Toasts['show']>) {
  act(() => toasts?.show(...args));
}

describe('Toast', () => {
  it('announces a short message politely and lets it vanish by itself', () => {
    expect(region()?.getAttribute('aria-live')).toBe('polite');
    show('Gespeichert als „Klasse.pdf“.');
    expect(region()?.textContent).toContain('Gespeichert als „Klasse.pdf“.');
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(region()?.textContent).toContain('Klasse.pdf');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(region()?.textContent).toBe('');
  });

  it('offers an action such as undo, runs it once and closes', () => {
    const undo = vi.fn<() => void>();
    show('Seite entfernt.', { action: { label: 'Rückgängig', onAction: undo } });
    click(button('Rückgängig'));
    expect(undo).toHaveBeenCalledOnce();
    expect(region()?.textContent).toBe('');
  });

  it('stays longer when it offers an action', () => {
    show('Seite entfernt.', { action: { label: 'Rückgängig', onAction: vi.fn<() => void>() } });
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(region()?.textContent).toContain('Seite entfernt.');
    act(() => {
      vi.advanceTimersByTime(TOAST_ACTION_DURATION_MS - TOAST_DURATION_MS);
    });
    expect(region()?.textContent).toBe('');
  });

  it('replaces the previous message and restarts the timer', () => {
    show('Erste Meldung.');
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 100);
    });
    show('Zweite Meldung.');
    expect(region()?.textContent).not.toContain('Erste');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(region()?.textContent).toContain('Zweite Meldung.');
  });

  it('pauses while hovered and can be closed by hand', () => {
    show('Tabelle kopiert.');
    const card = container.querySelector('.toast');
    act(() => {
      card?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 2);
    });
    expect(region()?.textContent).toContain('Tabelle kopiert.');
    click(button('Meldung schließen'));
    expect(region()?.textContent).toBe('');
  });

  it('marks errors', () => {
    show('Das PDF konnte nicht gespeichert werden.', { tone: 'error' });
    expect(container.querySelector('.toast')?.classList.contains('is-error')).toBe(true);
  });
});

function click(element: Element | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error('missing button');
  act(() => element.click());
}
