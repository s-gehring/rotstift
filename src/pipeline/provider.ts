import type { ModelInfo } from '../models/registry.ts';
import type { ModelState } from '../models/types.ts';
import type {
  EngineMonitor,
  ModelProblem,
  PageTranscriber,
  TranscriberStatus,
} from './transcriber.ts';

export interface ModelAvailability {
  readonly model: ModelInfo;
  readonly state: ModelState;
  readonly remote?: boolean;
  readonly second?: ModelInfo | null;
}

export interface TranscriberEnvironment {
  readonly isDev: boolean;
  readonly isTauri: boolean;
  readonly loadDemo: () => Promise<PageTranscriber>;
  readonly createModelTranscriber: (
    model: ModelInfo,
    onUnavailable?: () => void,
    remote?: boolean,
    second?: ModelInfo | null,
  ) => PageTranscriber & { readonly engine?: EngineMonitor };
}

export const DESKTOP_ONLY_MESSAGE = 'Die Texterkennung steht nur in der Desktop-App zur Verfügung.';

function modelProblem(state: Exclude<ModelState, 'ready'>): ModelProblem {
  return state === 'unverified' ? 'verifying' : state;
}

export async function resolveTranscriber(
  env: TranscriberEnvironment,
  availability: ModelAvailability | null,
  onUnavailable?: () => void,
): Promise<TranscriberStatus | null> {
  if (env.isTauri) {
    if (availability === null) return null;
    if (availability.state !== 'ready') {
      return { state: 'needs-model', problem: modelProblem(availability.state) };
    }
    const transcriber = env.createModelTranscriber(
      availability.model,
      onUnavailable,
      availability.remote === true,
      availability.second ?? null,
    );
    return { state: 'ready', transcriber, demo: false, engine: transcriber.engine };
  }
  if (env.isDev) return { state: 'ready', transcriber: await env.loadDemo(), demo: true };
  return { state: 'unavailable', message: DESKTOP_ONLY_MESSAGE };
}
