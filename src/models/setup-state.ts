import { pushSample, type Sample } from './format.ts';
import { MODELS, recommendModel, type ModelInfo } from './registry.ts';
import type { DownloadError, DownloadEvent, HardwareInfo, ModelStatus } from './types.ts';

export interface SetupState {
  readonly loaded: boolean;
  readonly statuses: Readonly<Record<string, ModelStatus>>;
  readonly hardware: HardwareInfo | null;
  readonly samples: readonly Sample[];
  readonly error: DownloadError | null;
  readonly note: string | null;
  readonly importing: boolean;
}

export type SetupAction =
  | { type: 'loaded'; statuses: readonly ModelStatus[]; hardware: HardwareInfo | null }
  | { type: 'status'; status: ModelStatus }
  | { type: 'mark'; modelId: string; state: ModelStatus['state'] }
  | { type: 'event'; event: DownloadEvent; at: number }
  | { type: 'error'; error: DownloadError | null }
  | { type: 'note'; note: string | null }
  | { type: 'importing'; importing: boolean };

export const INITIAL_SETUP: SetupState = {
  loaded: false,
  statuses: {},
  hardware: null,
  samples: [],
  error: null,
  note: null,
  importing: false,
};

function withStatus(state: SetupState, status: ModelStatus): SetupState['statuses'] {
  return { ...state.statuses, [status.modelId]: status };
}

function applyEvent(state: SetupState, event: DownloadEvent, at: number): SetupState {
  const known = state.statuses[event.modelId];
  switch (event.state) {
    case 'progress':
      return {
        ...state,
        error: null,
        note: null,
        statuses: withStatus(state, {
          modelId: event.modelId,
          state: 'downloading',
          downloadedBytes: event.downloadedBytes,
          totalBytes: event.totalBytes,
        }),
        samples: pushSample(state.samples, { at, bytes: event.downloadedBytes }),
      };
    case 'done':
      return {
        ...state,
        samples: [],
        statuses: known
          ? withStatus(state, { ...known, state: 'ready', downloadedBytes: known.totalBytes })
          : state.statuses,
      };
    case 'cancelled':
      return {
        ...state,
        samples: [],
        statuses: known ? withStatus(state, { ...known, state: 'missing' }) : state.statuses,
      };
    case 'failed':
      return {
        ...state,
        samples: [],
        error: event.error,
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
    case 'loaded':
      return {
        ...state,
        loaded: true,
        hardware: action.hardware ?? state.hardware,
        statuses: Object.fromEntries(
          [...Object.values(state.statuses), ...action.statuses].map((status) => [
            status.modelId,
            status,
          ]),
        ),
      };
    case 'status':
      return { ...state, statuses: withStatus(state, action.status) };
    case 'mark': {
      const known = state.statuses[action.modelId];
      return known
        ? { ...state, statuses: withStatus(state, { ...known, state: action.state }) }
        : state;
    }
    case 'event':
      return applyEvent(state, action.event, action.at);
    case 'error':
      return { ...state, error: action.error };
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

export function activeModel(state: SetupState, models: readonly ModelInfo[] = MODELS): ModelInfo {
  const recommended = recommendModel(state.hardware?.totalRamBytes ?? null, models);
  const ready = models.filter((model) => state.statuses[model.id]?.state === 'ready');
  return ready.find((model) => model.id === recommended.id) ?? ready[0] ?? recommended;
}
