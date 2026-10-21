// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEUTSCH, ENGLISCH } from '../annotations/profile.ts';
import { AppProvider } from '../app/app-context.tsx';
import { testAppModel } from '../app/test-app.ts';
import { useWeighting } from '../stats/use-weighting.ts';
import { WEIGHTING_STORAGE_KEY, type WeightingStorage } from '../stats/weighting-storage.ts';
import { WeightingSettings } from './WeightingSettings.tsx';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLElement;
let root: Root;
let stored: string | null;

const storage: WeightingStorage = {
  getItem: () => stored,
  setItem: (_key, value) => {
    stored = value;
  },
};

function Live() {
  const weighting = useWeighting(storage);
  return (
    <AppProvider value={testAppModel({ weighting })}>
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

const weightSelect = (name: string) =>
  container.querySelector<HTMLSelectElement>(`select[aria-label="Gewicht ${name}"]`);
const subjectSelect = () => container.querySelector<HTMLSelectElement>('.weighting-subject select');
const repeats = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]');
const reset = () =>
  [...container.querySelectorAll('button')].find((button) => button.textContent === 'Zurücksetzen');

function choose(select: HTMLSelectElement | null | undefined, value: string) {
  act(() => {
    if (select == null) return;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('the Fehlergewichtung settings', () => {
  it('is collapsed and lists the error kinds of the current subject', () => {
    expect(container.querySelector('details')?.open).toBe(false);
    expect(container.querySelector('summary')?.textContent).toBe('Fehlergewichtung');
    expect(subjectSelect()?.value).toBe(DEUTSCH.id);
    expect(container.querySelectorAll('.weighting-kinds li')).toHaveLength(
      DEUTSCH.allowedTypes.length,
    );
    expect(weightSelect('Rechtschreibung')?.value).toBe('1');
    expect(repeats()?.checked).toBe(true);
    expect(reset()?.disabled).toBe(true);
  });

  it('stores a changed weight and offers to reset it', () => {
    choose(weightSelect('Rechtschreibung'), '0.5');
    expect(weightSelect('Rechtschreibung')?.value).toBe('0.5');
    expect(JSON.parse(stored ?? '{}')).toMatchObject({ deutsch: { weights: { R: 0.5 } } });
    expect(reset()?.disabled).toBe(false);
    act(() => reset()?.click());
    expect(weightSelect('Rechtschreibung')?.value).toBe('1');
    expect(JSON.parse(stored ?? '{}')).toEqual({});
    expect(WEIGHTING_STORAGE_KEY).toBe('rotstift.weighting');
  });

  it('switches repeated errors on and off', () => {
    act(() => repeats()?.click());
    expect(repeats()?.checked).toBe(false);
    expect(JSON.parse(stored ?? '{}')).toMatchObject({ deutsch: { repeatsOnce: false } });
  });

  it('keeps the weights of each subject apart', () => {
    choose(subjectSelect(), ENGLISCH.id);
    expect(weightSelect('Rechtschreibung (spelling)')?.value).toBe('0.5');
    expect(weightSelect('Zeichensetzung (punctuation)')?.value).toBe('0');
    choose(weightSelect('Grammatik (grammar)'), '2');
    choose(subjectSelect(), DEUTSCH.id);
    expect(weightSelect('Grammatik')?.value).toBe('1');
  });
});
