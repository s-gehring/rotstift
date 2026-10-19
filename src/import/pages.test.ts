import { describe, expect, it } from 'vitest';
import {
  pagesReducer,
  rotate,
  rotatedSize,
  type ImportPage,
  type PagesAction,
  type Rotation,
} from './pages.ts';

function page(id: string, overrides: Partial<ImportPage> = {}): ImportPage {
  return {
    id,
    label: id,
    source: { kind: 'pdf', documentId: 'doc', pageNumber: 1 },
    width: 100,
    height: 200,
    rotation: 0,
    thumbnailUrl: `blob:${id}`,
    ...overrides,
  };
}

function ids(pages: readonly ImportPage[]): string[] {
  return pages.map((p) => p.id);
}

function apply(pages: readonly ImportPage[], ...actions: PagesAction[]): readonly ImportPage[] {
  return actions.reduce(pagesReducer, pages);
}

describe('add', () => {
  it('appends pages in order', () => {
    const result = apply([page('a')], { type: 'add', pages: [page('b'), page('c')] });
    expect(ids(result)).toEqual(['a', 'b', 'c']);
  });
});

describe('rotate', () => {
  it('cycles clockwise through all four steps', () => {
    const steps: Rotation[] = [];
    let rotation: Rotation = 0;
    for (let i = 0; i < 4; i++) {
      rotation = rotate(rotation, 'clockwise');
      steps.push(rotation);
    }
    expect(steps).toEqual([90, 180, 270, 0]);
  });

  it('cycles counterclockwise', () => {
    expect(rotate(0, 'counterclockwise')).toBe(270);
    expect(rotate(90, 'counterclockwise')).toBe(0);
  });

  it('rotates only the addressed page', () => {
    const result = apply([page('a'), page('b')], {
      type: 'rotate',
      id: 'b',
      direction: 'clockwise',
    });
    expect(result.map((p) => p.rotation)).toEqual([0, 90]);
  });

  it('swaps the size for sideways rotations', () => {
    expect(rotatedSize(page('a', { rotation: 90 }))).toEqual({ width: 200, height: 100 });
    expect(rotatedSize(page('a', { rotation: 180 }))).toEqual({ width: 100, height: 200 });
  });
});

describe('move', () => {
  const abc = [page('a'), page('b'), page('c')];

  it('moves a page forward to the target index', () => {
    expect(ids(apply(abc, { type: 'move', id: 'a', toIndex: 2 }))).toEqual(['b', 'c', 'a']);
  });

  it('moves a page backward to the target index', () => {
    expect(ids(apply(abc, { type: 'move', id: 'c', toIndex: 0 }))).toEqual(['c', 'a', 'b']);
  });

  it('moves by one position', () => {
    expect(ids(apply(abc, { type: 'move', id: 'b', toIndex: 2 }))).toEqual(['a', 'c', 'b']);
  });

  it('clamps the target index', () => {
    expect(ids(apply(abc, { type: 'move', id: 'a', toIndex: 99 }))).toEqual(['b', 'c', 'a']);
    expect(ids(apply(abc, { type: 'move', id: 'c', toIndex: -5 }))).toEqual(['c', 'a', 'b']);
  });

  it('returns the same list for no-ops and unknown ids', () => {
    expect(apply(abc, { type: 'move', id: 'b', toIndex: 1 })).toBe(abc);
    expect(apply(abc, { type: 'move', id: 'x', toIndex: 0 })).toBe(abc);
  });
});

describe('remove and clear', () => {
  it('removes one page', () => {
    expect(ids(apply([page('a'), page('b')], { type: 'remove', id: 'a' }))).toEqual(['b']);
  });

  it('ignores unknown ids', () => {
    const pages = [page('a')];
    expect(apply(pages, { type: 'remove', id: 'x' })).toBe(pages);
  });

  it('clears everything', () => {
    expect(apply([page('a'), page('b')], { type: 'clear' })).toEqual([]);
  });
});
