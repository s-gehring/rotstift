import { arbeitenReducer, restoreArbeiten, type Arbeit, type ArbeitenAction } from './arbeiten.ts';

export interface ImportState {
  readonly arbeiten: readonly Arbeit[];
  readonly removed: readonly Arbeit[] | null;
}

export type ImportAction =
  ArbeitenAction | { readonly type: 'undo' } | { readonly type: 'expire-undo' };

export const INITIAL_IMPORT_STATE: ImportState = { arbeiten: [], removed: null };

const REMOVALS: ReadonlySet<ImportAction['type']> = new Set([
  'remove-page',
  'remove-arbeit',
  'clear',
]);

export function importReducer(state: ImportState, action: ImportAction): ImportState {
  if (action.type === 'undo') {
    return state.removed === null
      ? state
      : { arbeiten: restoreArbeiten(state.arbeiten, state.removed), removed: null };
  }
  if (action.type === 'expire-undo') {
    return state.removed === null ? state : { ...state, removed: null };
  }
  const arbeiten = arbeitenReducer(state.arbeiten, action);
  if (arbeiten === state.arbeiten) return state;
  return { arbeiten, removed: REMOVALS.has(action.type) ? state.arbeiten : state.removed };
}
