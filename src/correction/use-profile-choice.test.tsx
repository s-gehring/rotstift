// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEUTSCH, ENGLISCH } from '../annotations/profile.ts';
import { PROFILE_STORAGE_KEY } from './profile-choice.ts';
import { useProfileChoice } from './use-profile-choice.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useProfileChoice> | null = null;

function Harness() {
  const choice = useProfileChoice();
  useEffect(() => {
    latest = choice;
  });
  return null;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  latest = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
});

describe('useProfileChoice', () => {
  it('starts with the first profile and persists the choice', () => {
    act(() => root.render(<Harness />));
    expect(latest?.profile).toBe(DEUTSCH);
    act(() => latest?.select(ENGLISCH));
    expect(latest?.profile).toBe(ENGLISCH);
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBe('englisch');
  });

  it('restores the last choice', () => {
    localStorage.setItem(PROFILE_STORAGE_KEY, 'englisch');
    act(() => root.render(<Harness />));
    expect(latest?.profile).toBe(ENGLISCH);
  });

  it('keeps working when the storage refuses access', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('gesperrt');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('gesperrt');
    });
    act(() => root.render(<Harness />));
    act(() => latest?.select(ENGLISCH));
    expect(latest?.profile).toBe(ENGLISCH);
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
