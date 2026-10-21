import { describe, expect, it } from 'vitest';
import {
  arbeitenReducer,
  defaultArbeitName,
  findPage,
  flattenPages,
  restoreArbeiten,
  type Arbeit,
} from './arbeiten.ts';
import type { ImportPage } from './pages.ts';

function page(id: string): ImportPage {
  return {
    id,
    fileKey: id,
    label: `${id}.png`,
    source: { kind: 'image', file: new File([], `${id}.png`) },
    width: 10,
    height: 20,
    rotation: 0,
    thumbnailUrl: `blob:${id}`,
  };
}

function arbeit(id: string, ...pageIds: string[]): Arbeit {
  return { id, name: id.toUpperCase(), pages: pageIds.map(page) };
}

const ids = (arbeiten: readonly Arbeit[]) =>
  arbeiten.map((item) => `${item.id}:${item.pages.map((p) => p.id).join(',')}`);

describe('defaultArbeitName', () => {
  it('uses the file name without its extension', () => {
    expect(defaultArbeitName('Anna Müller.pdf')).toBe('Anna Müller');
    expect(defaultArbeitName('scan.2026.final.PNG')).toBe('scan.2026.final');
  });

  it('keeps names without an extension and dot files', () => {
    expect(defaultArbeitName('Anna')).toBe('Anna');
    expect(defaultArbeitName('.png')).toBe('.png');
  });
});

describe('arbeitenReducer', () => {
  const start = [arbeit('a', 'a1', 'a2', 'a3'), arbeit('b', 'b1')];

  it('adds an Arbeit at the end and ignores one without pages', () => {
    expect(ids(arbeitenReducer(start, { type: 'add', arbeit: arbeit('c', 'c1') }))).toEqual([
      'a:a1,a2,a3',
      'b:b1',
      'c:c1',
    ]);
    expect(arbeitenReducer(start, { type: 'add', arbeit: arbeit('c') })).toBe(start);
  });

  it('renames with trimmed text and refuses an empty name', () => {
    const renamed = arbeitenReducer(start, { type: 'rename', id: 'b', name: '  Ben  ' });
    expect(renamed.map((item) => item.name)).toEqual(['A', 'Ben']);
    expect(arbeitenReducer(start, { type: 'rename', id: 'b', name: '   ' })).toBe(start);
    expect(arbeitenReducer(start, { type: 'rename', id: 'b', name: 'B' })).toBe(start);
  });

  it('rotates a page inside its Arbeit', () => {
    const rotated = arbeitenReducer(start, {
      type: 'rotate',
      pageId: 'a2',
      direction: 'clockwise',
    });
    expect(rotated[0]?.pages.map((p) => p.rotation)).toEqual([0, 90, 0]);
    expect(rotated[1]).toBe(start[1]);
  });

  it('reorders pages inside one Arbeit', () => {
    const moved = arbeitenReducer(start, {
      type: 'place',
      pageId: 'a3',
      arbeitId: 'a',
      toIndex: 0,
    });
    expect(ids(moved)).toEqual(['a:a3,a1,a2', 'b:b1']);
  });

  it('moves a page into another Arbeit at the given position', () => {
    const moved = arbeitenReducer(start, {
      type: 'place',
      pageId: 'a2',
      arbeitId: 'b',
      toIndex: 0,
    });
    expect(ids(moved)).toEqual(['a:a1,a3', 'b:a2,b1']);
  });

  it('drops an Arbeit that lost its last page', () => {
    const moved = arbeitenReducer(start, {
      type: 'place',
      pageId: 'b1',
      arbeitId: 'a',
      toIndex: 9,
    });
    expect(ids(moved)).toEqual(['a:a1,a2,a3,b1']);
  });

  it('removes a page and an Arbeit that becomes empty', () => {
    const removed = arbeitenReducer(start, { type: 'remove-page', pageId: 'b1' });
    expect(ids(removed)).toEqual(['a:a1,a2,a3']);
    expect(ids(arbeitenReducer(start, { type: 'remove-page', pageId: 'a1' }))[0]).toBe('a:a2,a3');
  });

  it('removes a whole Arbeit', () => {
    expect(ids(arbeitenReducer(start, { type: 'remove-arbeit', id: 'a' }))).toEqual(['b:b1']);
    expect(arbeitenReducer(start, { type: 'remove-arbeit', id: 'zzz' })).toBe(start);
  });

  it('splits a page off into a new Arbeit right behind its source', () => {
    const split = arbeitenReducer(start, { type: 'split', pageId: 'a2', newArbeitId: 'n' });
    expect(ids(split)).toEqual(['a:a1,a3', 'n:a2', 'b:b1']);
    expect(split[1]?.name).toBe('A (Seite 2)');
  });

  it('does not split the only page of an Arbeit', () => {
    expect(arbeitenReducer(start, { type: 'split', pageId: 'b1', newArbeitId: 'n' })).toBe(start);
  });

  it('merges selected Arbeiten into the first one, keeping page order', () => {
    const three = [
      arbeit('a', 'a1'),
      arbeit('b', 'b1', 'b2'),
      arbeit('c', 'c1'),
      arbeit('d', 'd1'),
    ];
    const merged = arbeitenReducer(three, { type: 'merge', ids: ['d', 'b', 'a'] });
    expect(ids(merged)).toEqual(['a:a1,b1,b2,d1', 'c:c1']);
    expect(merged[0]?.name).toBe('A');
  });

  it('needs two Arbeiten to merge', () => {
    expect(arbeitenReducer(start, { type: 'merge', ids: ['a'] })).toBe(start);
    expect(arbeitenReducer(start, { type: 'merge', ids: ['a', 'zzz'] })).toBe(start);
  });

  it('splits an Arbeit at a page and moves it and all following pages to a new Arbeit', () => {
    const next = arbeitenReducer(start, { type: 'split-from', pageId: 'a2', newArbeitId: 'n' });
    expect(ids(next).slice(0, 3)).toEqual(['a:a1', 'n:a2,a3', 'b:b1']);
    expect(next[1]?.name).toBe('A (ab Seite 2)');
  });

  it('does not split at the first page', () => {
    expect(arbeitenReducer(start, { type: 'split-from', pageId: 'a1', newArbeitId: 'n' })).toBe(
      start,
    );
  });

  it('clears everything', () => {
    expect(arbeitenReducer(start, { type: 'clear' })).toEqual([]);
    const empty: readonly Arbeit[] = [];
    expect(arbeitenReducer(empty, { type: 'clear' })).toBe(empty);
  });
});

describe('flattenPages and findPage', () => {
  const arbeiten = [arbeit('a', 'a1', 'a2'), arbeit('b', 'b1')];

  it('lists the pages Arbeit by Arbeit', () => {
    expect(flattenPages(arbeiten).map((p) => p.id)).toEqual(['a1', 'a2', 'b1']);
  });

  it('finds the Arbeit and the index of a page', () => {
    expect(findPage(arbeiten, 'a2')).toMatchObject({ index: 1, arbeit: { id: 'a' } });
    expect(findPage(arbeiten, 'zzz')).toBeUndefined();
  });
});

describe('restoreArbeiten', () => {
  const snapshot = [arbeit('a', 'a1', 'a2', 'a3'), arbeit('b', 'b1'), arbeit('c', 'c1', 'c2')];

  it('brings back a removed Arbeit at its old position', () => {
    const current = [snapshot[0]!, snapshot[2]!];
    expect(ids(restoreArbeiten(current, snapshot))).toEqual(ids(snapshot));
  });

  it('brings back a removed page at its old index', () => {
    const current = [
      { ...snapshot[0]!, pages: [snapshot[0]!.pages[0]!, snapshot[0]!.pages[2]!] },
      snapshot[1]!,
      snapshot[2]!,
    ];
    expect(ids(restoreArbeiten(current, snapshot))).toEqual(ids(snapshot));
  });

  it('restores everything after clear', () => {
    expect(ids(restoreArbeiten([], snapshot))).toEqual(ids(snapshot));
  });

  it('keeps changes made after the removal', () => {
    const current = [
      { ...snapshot[0]!, name: 'Neu', pages: [snapshot[0]!.pages[0]!] },
      arbeit('d', 'd1'),
    ];
    const restored = restoreArbeiten(current, snapshot);
    expect(ids(restored)).toEqual(['a:a1,a2,a3', 'b:b1', 'c:c1,c2', 'd:d1']);
    expect(restored[0]?.name).toBe('Neu');
  });

  it('does not duplicate pages that moved to another Arbeit meanwhile', () => {
    const current = [
      { ...snapshot[0]!, pages: [snapshot[0]!.pages[0]!] },
      { ...snapshot[1]!, pages: [snapshot[1]!.pages[0]!, snapshot[0]!.pages[1]!] },
    ];
    expect(ids(restoreArbeiten(current, snapshot))).toEqual(['a:a1,a3', 'b:b1,a2', 'c:c1,c2']);
  });

  it('returns an equal list when nothing is missing', () => {
    expect(ids(restoreArbeiten(snapshot, snapshot))).toEqual(ids(snapshot));
  });
});
