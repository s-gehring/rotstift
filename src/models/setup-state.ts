import { pushSample, type Sample } from './format.ts';
import {
  DEFAULT_MODEL_ID,
  MODELS,
  offeredModels,
  recommendModel,
  type AnyModelInfo,
  type ModelInfo,
} from './registry.ts';
import type {
  DownloadError,
  DownloadEvent,
  HardwareInfo,
  ModelState,
  ModelStatus,
} from './types.ts';

export const ANY_MODEL = '*';

const RUNNING_JOBS: ReadonlySet<ModelState> = new Set([
  'downloading',
  'verifying',
  'importing',
  'deleting',
]);

export interface SetupState {
  readonly loaded: boolean;
  readonly statuses: Readonly<Record<string, ModelStatus>>;
  readonly hardware: HardwareInfo | null;
  readonly selectedId: string | null;
  readonly samples: Readonly<Record<string, readonly Sample[]>>;
  readonly baselines: Readonly<Record<string, number>>;
  readonly errors: Readonly<Record<string, DownloadError>>;
  readonly note: string | null;
  readonly importing: boolean;
}

export type SetupAction =
  | {
      type: 'loaded';
      statuses: readonly ModelStatus[];
      hardware: HardwareInfo | null;
      selectedId?: string | null;
    }
  | { type: 'selected'; modelId: string }
  | { type: 'started'; modelId: string; presentBytes: number }
  | { type: 'status'; status: ModelStatus }
  | { type: 'mark'; modelId: string; state: ModelStatus['state'] }
  | { type: 'event'; event: DownloadEvent; at: number }
  | { type: 'error'; modelId: string; error: DownloadError | null }
  | { type: 'note'; note: string | null }
  | { type: 'importing'; importing: boolean };

export const INITIAL_SETUP: SetupState = {
  loaded: false,
  statuses: {},
  hardware: null,
  selectedId: null,
  samples: {},
  baselines: {},
  errors: {},
  note: null,
  importing: false,
};

function withStatus(state: SetupState, status: ModelStatus): SetupState['statuses'] {
  return { ...state.statuses, [status.modelId]: status };
}

function withError(
  state: SetupState,
  modelId: string,
  error: DownloadError | null,
): SetupState['errors'] {
  const { [modelId]: _dropped, ...rest } = state.errors;
  return error === null ? rest : { ...rest, [modelId]: error };
}

function withoutSamples(state: SetupState, modelId: string): SetupState['samples'] {
  const { [modelId]: _dropped, ...rest } = state.samples;
  return rest;
}

export function samplesOf(state: SetupState, modelId: string): readonly Sample[] {
  return state.samples[modelId] ?? [];
}

export function baselineOf(state: SetupState, modelId: string): number {
  return state.baselines[modelId] ?? 0;
}

export function errorOf(state: SetupState, modelId: string): DownloadError | null {
  return state.errors[modelId] ?? state.errors[ANY_MODEL] ?? null;
}

export function hasRunningJob(state: SetupState): boolean {
  return Object.values(state.statuses).some((status) => RUNNING_JOBS.has(status.state));
}

function settledSelection(
  selectedId: string | null,
  statuses: SetupState['statuses'],
): string | null {
  const chosen = selectedId === null ? undefined : statuses[selectedId];
  if (chosen?.state !== 'missing' || chosen.downloadedBytes > 0) return selectedId;
  const ready = Object.values(statuses).filter(
    (status) => status.state === 'ready' && status.modelId !== chosen.modelId,
  );
  const fallback = ready.find((status) => status.modelId === DEFAULT_MODEL_ID) ?? ready[0];
  return fallback?.modelId ?? selectedId;
}

function applyEvent(state: SetupState, event: DownloadEvent, at: number): SetupState {
  const known = state.statuses[event.modelId];
  switch (event.state) {
    case 'progress':
      return {
        ...state,
        errors: withError(state, event.modelId, null),
        note: null,
        statuses: withStatus(state, {
          modelId: event.modelId,
          state: 'downloading',
          downloadedBytes: event.downloadedBytes,
          totalBytes: event.totalBytes,
        }),
        samples: {
          ...state.samples,
          [event.modelId]: pushSample(samplesOf(state, event.modelId), {
            at,
            bytes: event.downloadedBytes,
          }),
        },
      };
    case 'verifying':
      return known?.state === 'verifying'
        ? {
            ...state,
            statuses: withStatus(state, {
              ...known,
              downloadedBytes: event.downloadedBytes,
              totalBytes: event.totalBytes,
            }),
          }
        : state;
    case 'done':
      return {
        ...state,
        samples: withoutSamples(state, event.modelId),
        statuses: known
          ? withStatus(state, { ...known, state: 'ready', downloadedBytes: known.totalBytes })
          : state.statuses,
      };
    case 'cancelled':
      return {
        ...state,
        samples: withoutSamples(state, event.modelId),
        statuses: known ? withStatus(state, { ...known, state: 'missing' }) : state.statuses,
      };
    case 'failed':
      return {
        ...state,
        samples: withoutSamples(state, event.modelId),
        errors: withError(state, event.modelId, event.error),
        statuses: known ? withStatus(state, { ...known, state: 'missing' }) : state.statuses,
      };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

export function setupReducer(state: SetupState, action: SetupAction): SetupState {
  switch (action.type) {
    case 'loaded': {
      const statuses = Object.fromEntries(
        [...Object.values(state.statuses), ...action.statuses].map((status) => [
          status.modelId,
          status,
        ]),
      );
      const selectedId = action.selectedId === undefined ? state.selectedId : action.selectedId;
      return {
        ...state,
        loaded: true,
        hardware: action.hardware ?? state.hardware,
        selectedId: state.loaded ? selectedId : settledSelection(selectedId, statuses),
        statuses,
        errors: withError(state, ANY_MODEL, null),
      };
    }
    case 'selected':
      return { ...state, selectedId: action.modelId, note: null };
    case 'started':
      return {
        ...state,
        baselines: { ...state.baselines, [action.modelId]: action.presentBytes },
      };
    case 'status':
      return { ...state, statuses: withStatus(state, action.status) };
    case 'mark': {
      const known = state.statuses[action.modelId];
      if (known === undefined) return state;
      const downloadedBytes = action.state === 'verifying' ? 0 : known.downloadedBytes;
      return {
        ...state,
        statuses: withStatus(state, { ...known, state: action.state, downloadedBytes }),
      };
    }
    case 'event':
      return applyEvent(state, action.event, action.at);
    case 'error':
      return { ...state, errors: withError(state, action.modelId, action.error) };
    case 'note':
      return { ...state, note: action.note };
    case 'importing':
      return { ...state, importing: action.importing };
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

export function activeModel(state: SetupState): ModelInfo;
export function activeModel<T extends AnyModelInfo>(state: SetupState, models: readonly T[]): T;
export function activeModel(
  state: SetupState,
  models: readonly AnyModelInfo[] = MODELS,
): AnyModelInfo {
  const ram = state.hardware?.totalRamBytes ?? null;
  const chosen = models.find((model) => model.id === state.selectedId);
  const allowed =
    chosen !== undefined && (ram === null || offeredModels(ram, models).includes(chosen));
  return allowed ? chosen : recommendModel(models);
}
