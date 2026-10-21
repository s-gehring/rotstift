// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENGLISCH } from '../annotations/profile.ts';
import { AppProvider } from '../app/app-context.tsx';
import { testAppModel } from '../app/test-app.ts';
import type { GradingStorage } from '../stats/grading-storage.ts';
import { useGrading } from '../stats/use-grading.ts';
import { WeightingSettings } from './WeightingSettings.tsx';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLElement;
let root: Root;
let stored: string | null;

const storage: GradingStorage = {
  getItem: () => stored,
  setItem: (_key, value) => {
    stored = value;
  },
};

function Live() {
  const grading = useGrading(storage);
  return (
    <AppProvider value={testAppModel({ grading })}>
      <WeightingSettings />
    </AppProvider>
  );
}

beforeEach(() => {
  stored = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Live />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const toggle = () =>
  [...container.querySelectorAll<HTMLLabelElement>('.grading label')]
    .find((label) => label.textContent === 'Notenschwellen')
    ?.querySelector('input');
const limit = (label: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
const rows = () =>
  [...container.querySelectorAll('.grading-table tbody tr')].map(
    (row) => row.querySelector('th')?.textContent,
  );

function type(input: HTMLInputElement | null, value: string) {
  act(() => {
    if (input === null) return;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const saved = (): unknown => JSON.parse(stored ?? '{}');
const limits = (grades: readonly (number | null)[]) => ({ deutsch: { limits: { grades } } });

describe('the grade limits', () => {
  it('are off and hidden by default', () => {
    expect(toggle()?.checked).toBe(false);
    expect(container.querySelector('.grading-table')).toBeNull();
  });

  it('show an empty table for grades 1 to 6 when switched on', () => {
    act(() => toggle()?.click());
    expect(rows()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(limit('Note 1 bis')?.value).toBe('');
    expect(container.querySelector('.grading-rest')?.textContent).toBe('darüber');
    expect(JSON.parse(stored ?? '{}')).toMatchObject({ deutsch: { enabled: true } });
  });

  it('store a typed limit with a German decimal comma', () => {
    act(() => toggle()?.click());
    type(limit('Note 2 bis'), '2,5');
    expect(saved()).toMatchObject(limits([null, 2.5, null, null, null]));
    type(limit('Note 2 bis'), '');
    expect(saved()).toMatchObject(limits([null, null, null, null, null]));
  });

  it('mark text that is no limit and limits that are not ascending', () => {
    act(() => toggle()?.click());
    type(limit('Note 1 bis'), 'viel');
    expect(limit('Note 1 bis')?.getAttribute('aria-invalid')).toBe('true');
    expect(saved()).toMatchObject(limits([null, null, null, null, null]));
    type(limit('Note 1 bis'), '3');
    type(limit('Note 2 bis'), '2');
    expect(limit('Note 1 bis')?.getAttribute('aria-invalid')).toBe('false');
    expect(limit('Note 2 bis')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('switch to points 15 to 0 for the upper school', () => {
    act(() => toggle()?.click());
    const points = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Punkte 15–0',
    );
    act(() => points?.click());
    expect(rows()).toHaveLength(16);
    expect(rows()[0]).toBe('15');
    expect(rows().at(-1)).toBe('0');
    expect(limit('Punkte 15 bis')).not.toBeNull();
  });

  it('belong to the chosen subject', () => {
    act(() => toggle()?.click());
    const subject = container.querySelector<HTMLSelectElement>('.weighting-subject select');
    act(() => {
      if (subject === null) return;
      subject.value = ENGLISCH.id;
      subject.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(toggle()?.checked).toBe(false);
  });
});
