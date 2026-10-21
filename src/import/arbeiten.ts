import { pagesReducer, type ImportPage, type PagesAction } from './pages.ts';

export interface Arbeit {
  readonly id: string;
  readonly name: string;
  readonly pages: readonly ImportPage[];
}

export type ArbeitenAction =
  | { readonly type: 'add'; readonly arbeit: Arbeit }
  | { readonly type: 'rename'; readonly id: string; readonly name: string }
  | {
      readonly type: 'rotate';
      readonly pageId: string;
      readonly direction: 'clockwise' | 'counterclockwise';
    }
  | { readonly type: 'remove-page'; readonly pageId: string }
  | { readonly type: 'remove-arbeit'; readonly id: string }
  | {
      readonly type: 'place';
      readonly pageId: string;
      readonly arbeitId: string;
      readonly toIndex: number;
    }
  | { readonly type: 'split'; readonly pageId: string; readonly newArbeitId: string }
  | { readonly type: 'split-from'; readonly pageId: string; readonly newArbeitId: string }
  | { readonly type: 'merge'; readonly ids: readonly string[] }
  | { readonly type: 'clear' };

export function defaultArbeitName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return stem.trim() === '' ? fileName : stem.trim();
}

export function flattenPages(arbeiten: readonly Arbeit[]): readonly ImportPage[] {
  return arbeiten.flatMap((arbeit) => arbeit.pages);
}

export function findPage(
  arbeiten: readonly Arbeit[],
  pageId: string,
): { readonly arbeit: Arbeit; readonly index: number } | undefined {
  for (const arbeit of arbeiten) {
    const index = arbeit.pages.findIndex((page) => page.id === pageId);
    if (index >= 0) return { arbeit, index };
  }
  return undefined;
}

function updatePages(
  arbeiten: readonly Arbeit[],
  pageId: string,
  action: PagesAction,
): readonly Arbeit[] {
  return arbeiten.flatMap((arbeit): Arbeit[] => {
    if (!arbeit.pages.some((page) => page.id === pageId)) return [arbeit];
    const pages = pagesReducer(arbeit.pages, action);
    if (pages === arbeit.pages) return [arbeit];
    return pages.length === 0 ? [] : [{ ...arbeit, pages }];
  });
}

function place(
  arbeiten: readonly Arbeit[],
  pageId: string,
  arbeitId: string,
  toIndex: number,
): readonly Arbeit[] {
  const source = findPage(arbeiten, pageId);
  const target = arbeiten.find((arbeit) => arbeit.id === arbeitId);
  if (source === undefined || target === undefined) return arbeiten;
  if (source.arbeit.id === target.id) {
    return updatePages(arbeiten, pageId, { type: 'move', id: pageId, toIndex });
  }
  const moving = source.arbeit.pages[source.index];
  if (moving === undefined) return arbeiten;
  return arbeiten.flatMap((arbeit): Arbeit[] => {
    if (arbeit.id === source.arbeit.id) {
      const pages = arbeit.pages.filter((page) => page.id !== pageId);
      return pages.length === 0 ? [] : [{ ...arbeit, pages }];
    }
    if (arbeit.id === target.id) {
      const at = Math.min(Math.max(toIndex, 0), arbeit.pages.length);
      return [
        { ...arbeit, pages: [...arbeit.pages.slice(0, at), moving, ...arbeit.pages.slice(at)] },
      ];
    }
    return [arbeit];
  });
}

function split(
  arbeiten: readonly Arbeit[],
  pageId: string,
  newArbeitId: string,
): readonly Arbeit[] {
  const source = findPage(arbeiten, pageId);
  if (source === undefined || source.arbeit.pages.length < 2) return arbeiten;
  const moving = source.arbeit.pages[source.index];
  if (moving === undefined) return arbeiten;
  return arbeiten.flatMap((arbeit): Arbeit[] => {
    if (arbeit.id !== source.arbeit.id) return [arbeit];
    return [
      { ...arbeit, pages: arbeit.pages.filter((page) => page.id !== pageId) },
      { id: newArbeitId, name: `${arbeit.name} (Seite ${source.index + 1})`, pages: [moving] },
    ];
  });
}

function splitFrom(
  arbeiten: readonly Arbeit[],
  pageId: string,
  newArbeitId: string,
): readonly Arbeit[] {
  const source = findPage(arbeiten, pageId);
  if (source === undefined || source.index === 0) return arbeiten;
  const { arbeit, index } = source;
  return arbeiten.flatMap((candidate): Arbeit[] => {
    if (candidate.id !== arbeit.id) return [candidate];
    return [
      { ...arbeit, pages: arbeit.pages.slice(0, index) },
      {
        id: newArbeitId,
        name: `${arbeit.name} (ab Seite ${index + 1})`,
        pages: arbeit.pages.slice(index),
      },
    ];
  });
}

function merge(arbeiten: readonly Arbeit[], ids: readonly string[]): readonly Arbeit[] {
  const selected = arbeiten.filter((arbeit) => ids.includes(arbeit.id));
  const [first] = selected;
  if (first === undefined || selected.length < 2) return arbeiten;
  const pages = selected.flatMap((arbeit) => arbeit.pages);
  return arbeiten.flatMap((arbeit): Arbeit[] => {
    if (arbeit.id === first.id) return [{ ...first, pages }];
    return selected.includes(arbeit) ? [] : [arbeit];
  });
}

export function restoreArbeiten(
  current: readonly Arbeit[],
  snapshot: readonly Arbeit[],
): readonly Arbeit[] {
  let result = [...current];
  for (const [snapshotIndex, original] of snapshot.entries()) {
    const present = new Set(result.flatMap((arbeit) => arbeit.pages.map((page) => page.id)));
    const existing = result.findIndex((arbeit) => arbeit.id === original.id);
    if (existing < 0) {
      const pages = original.pages.filter((page) => !present.has(page.id));
      if (pages.length === 0) continue;
      const before = snapshot
        .slice(0, snapshotIndex)
        .map((arbeit) => result.findIndex((candidate) => candidate.id === arbeit.id))
        .filter((position) => position >= 0);
      const at = before.length === 0 ? 0 : Math.max(...before) + 1;
      result = [...result.slice(0, at), { ...original, pages }, ...result.slice(at)];
      continue;
    }
    const target = result[existing];
    if (target === undefined) continue;
    const pages = [...target.pages];
    for (const [pageIndex, page] of original.pages.entries()) {
      if (present.has(page.id)) continue;
      const anchors = original.pages
        .slice(0, pageIndex)
        .map((earlier) => pages.findIndex((candidate) => candidate.id === earlier.id))
        .filter((position) => position >= 0);
      pages.splice(anchors.length === 0 ? 0 : Math.max(...anchors) + 1, 0, page);
    }
    if (pages.length !== target.pages.length) result[existing] = { ...target, pages };
  }
  return result;
}

export function arbeitenReducer(
  arbeiten: readonly Arbeit[],
  action: ArbeitenAction,
): readonly Arbeit[] {
  switch (action.type) {
    case 'add':
      return action.arbeit.pages.length === 0 ? arbeiten : [...arbeiten, action.arbeit];
    case 'rename': {
      const name = action.name.trim();
      if (name === '') return arbeiten;
      return arbeiten.some((arbeit) => arbeit.id === action.id && arbeit.name !== name)
        ? arbeiten.map((arbeit) => (arbeit.id === action.id ? { ...arbeit, name } : arbeit))
        : arbeiten;
    }
    case 'rotate':
      return updatePages(arbeiten, action.pageId, {
        type: 'rotate',
        id: action.pageId,
        direction: action.direction,
      });
    case 'remove-page':
      return updatePages(arbeiten, action.pageId, { type: 'remove', id: action.pageId });
    case 'remove-arbeit':
      return arbeiten.some((arbeit) => arbeit.id === action.id)
        ? arbeiten.filter((arbeit) => arbeit.id !== action.id)
        : arbeiten;
    case 'place':
      return place(arbeiten, action.pageId, action.arbeitId, action.toIndex);
    case 'split':
      return split(arbeiten, action.pageId, action.newArbeitId);
    case 'split-from':
      return splitFrom(arbeiten, action.pageId, action.newArbeitId);
    case 'merge':
      return merge(arbeiten, action.ids);
    case 'clear':
      return arbeiten.length === 0 ? arbeiten : [];
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}
