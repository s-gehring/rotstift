export type Rotation = 0 | 90 | 180 | 270;

export type PageSource =
  | { readonly kind: 'image'; readonly file: File }
  | { readonly kind: 'pdf'; readonly documentId: string; readonly pageNumber: number };

export interface ImportPage {
  readonly id: string;
  readonly label: string;
  readonly source: PageSource;
  /** Size in pixels at scale 1 before the user rotation, including a rotation stored in the file. */
  readonly width: number;
  readonly height: number;
  readonly rotation: Rotation;
  readonly thumbnailUrl: string;
}

export type PagesAction =
  | { readonly type: 'add'; readonly pages: readonly ImportPage[] }
  | {
      readonly type: 'rotate';
      readonly id: string;
      readonly direction: 'clockwise' | 'counterclockwise';
    }
  | { readonly type: 'move'; readonly id: string; readonly toIndex: number }
  | { readonly type: 'remove'; readonly id: string }
  | { readonly type: 'clear' };

const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

export function rotate(rotation: Rotation, direction: 'clockwise' | 'counterclockwise'): Rotation {
  const step = direction === 'clockwise' ? 1 : ROTATIONS.length - 1;
  return ROTATIONS[(ROTATIONS.indexOf(rotation) + step) % ROTATIONS.length] ?? 0;
}

export function rotatedSize(page: Pick<ImportPage, 'width' | 'height' | 'rotation'>): {
  width: number;
  height: number;
} {
  const sideways = page.rotation === 90 || page.rotation === 270;
  return sideways
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
}

export function pagesReducer(
  pages: readonly ImportPage[],
  action: PagesAction,
): readonly ImportPage[] {
  switch (action.type) {
    case 'add':
      return [...pages, ...action.pages];
    case 'rotate':
      return pages.map((page) =>
        page.id === action.id
          ? { ...page, rotation: rotate(page.rotation, action.direction) }
          : page,
      );
    case 'move': {
      const from = pages.findIndex((page) => page.id === action.id);
      const moving = pages[from];
      if (moving === undefined) return pages;
      const to = Math.min(Math.max(action.toIndex, 0), pages.length - 1);
      if (to === from) return pages;
      const rest = pages.filter((page) => page.id !== action.id);
      return [...rest.slice(0, to), moving, ...rest.slice(to)];
    }
    case 'remove':
      return pages.some((page) => page.id === action.id)
        ? pages.filter((page) => page.id !== action.id)
        : pages;
    case 'clear':
      return pages.length === 0 ? pages : [];
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}
