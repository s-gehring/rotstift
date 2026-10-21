import { describe, expect, it } from 'vitest';
import type { Arbeit } from './arbeiten.ts';
import { INITIAL_IMPORT_STATE, importReducer, type ImportAction } from './import-state.ts';
import type { ImportPage } from './pages.ts';

function page(id: string): ImportPage {
  return {
    id,
    fileKey: id,
    label: id,
    source: { kind: 'image', file: new File([], `${id}.png`) },
    width: 1,
    height: 1,
    rotation: 0,
    thumbnailUrl: `blob:${id}`,
  };
}

function arbeit(id: string, ...pageIds: string[]): Arbeit {
  return { id, name: id, pages: pageIds.map(page) };
}

function run(...actions: ImportAction[]) {
  return actions.reduce(importReducer, INITIAL_IMPORT_STATE);
}

const added = [
  { type: 'add', arbeit: arbeit('a', 'a1', 'a2') },
  { type: 'add', arbeit: arbeit('b', 'b1') },
] as const;

const ids = (arbeiten: readonly Arbeit[]) =>
  arbeiten.map((item) => `${item.id}:${item.pages.map((p) => p.id).join(',')}`);

describe('importReducer', () => {
  it('keeps the previous list after a removal and restores it on undo', () => {
    const removed = run(...added, { type: 'remove-arbeit', id: 'a' });
    expect(ids(removed.arbeiten)).toEqual(['b:b1']);
    expect(ids(removed.removed ?? [])).toEqual(['a:a1,a2', 'b:b1']);
    const restored = importReducer(removed, { type: 'undo' });
    expect(ids(restored.arbeiten)).toEqual(['a:a1,a2', 'b:b1']);
    expect(restored.removed).toBeNull();
  });

  it('undoes the removal of a single page and of everything', () => {
    const single = run(...added, { type: 'remove-page', pageId: 'a1' });
    expect(ids(importReducer(single, { type: 'undo' }).arbeiten)).toEqual(['a:a1,a2', 'b:b1']);
    const cleared = run(...added, { type: 'clear' });
    expect(cleared.arbeiten).toEqual([]);
    expect(ids(importReducer(cleared, { type: 'undo' }).arbeiten)).toEqual(['a:a1,a2', 'b:b1']);
  });

  it('only undoes the latest removal', () => {
    const state = run(
      ...added,
      { type: 'remove-arbeit', id: 'a' },
      { type: 'remove-arbeit', id: 'b' },
    );
    expect(ids(importReducer(state, { type: 'undo' }).arbeiten)).toEqual(['b:b1']);
  });

  it('does not hold anything for changes that are not removals', () => {
    const state = run(...added, { type: 'rotate', pageId: 'a1', direction: 'clockwise' });
    expect(state.removed).toBeNull();
    expect(importReducer(state, { type: 'undo' })).toBe(state);
  });

  it('ignores a removal that changes nothing', () => {
    const state = run(...added);
    expect(importReducer(state, { type: 'remove-arbeit', id: 'zzz' })).toBe(state);
  });

  it('forgets the held list when the undo window expires', () => {
    const state = run(...added, { type: 'remove-arbeit', id: 'a' });
    const expired = importReducer(state, { type: 'expire-undo' });
    expect(expired.removed).toBeNull();
    expect(importReducer(expired, { type: 'undo' })).toBe(expired);
  });

  it('keeps later changes when undoing', () => {
    const state = run(
      ...added,
      { type: 'remove-arbeit', id: 'a' },
      { type: 'rename', id: 'b', name: 'Ben' },
    );
    const restored = importReducer(state, { type: 'undo' });
    expect(restored.arbeiten.map((item) => item.name)).toEqual(['a', 'Ben']);
  });
});
