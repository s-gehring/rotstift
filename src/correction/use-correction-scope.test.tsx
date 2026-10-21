// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SCOPE, SCOPE_STORAGE_KEY } from './scope.ts';
import { useCorrectionScope } from './use-correction-scope.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useCorrectionScope> | null = null;

function Harness({ hasClass }: { readonly hasClass: boolean }) {
  const scope = useCorrectionScope(hasClass);
  useEffect(() => {
    latest = scope;
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

describe('useCorrectionScope', () => {
  it('keeps the kinds across sessions but not the assignment', () => {
    act(() => root.render(<Harness hasClass />));
    expect(latest?.scope).toEqual(DEFAULT_SCOPE);
    act(() => latest?.setScope({ ...DEFAULT_SCOPE, grammar: false, assignment: 'Brief' }));
    expect(localStorage.getItem(SCOPE_STORAGE_KEY)).not.toContain('Brief');

    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<Harness hasClass />));
    expect(latest?.scope).toEqual({ ...DEFAULT_SCOPE, grammar: false });
  });

  it('forgets the assignment when the class is emptied', () => {
    act(() => root.render(<Harness hasClass={false} />));
    act(() => latest?.setScope({ ...DEFAULT_SCOPE, assignment: 'Brief', formName: 'Brief' }));
    act(() => root.render(<Harness hasClass />));
    expect(latest?.scope.assignment).toBe('Brief');
    act(() => root.render(<Harness hasClass={false} />));
    expect(latest?.scope).toEqual(DEFAULT_SCOPE);
  });
});
