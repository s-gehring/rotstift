import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { createLlmClient, type Invoke, type LlmClient } from '../llm/client.ts';
import { sharedEngine, type LlmEngine } from '../llm/engine.ts';
import type { ModelClient } from '../models/client.ts';
import { browserModelClient } from '../pipeline/environment.ts';
import {
  type AnyModelInfo,
  DEFAULT_CORRECTOR_ID,
  DEFAULT_MODEL_ID,
  DEFAULT_REVIEWER_ID,
  findCorrector,
} from '../models/registry.ts';
import {
  loadSecondReading,
  STRONGER_CORRECTOR_ID,
  thoroughnessOf,
  type StepChoice,
  type Thoroughness,
} from '../models/thoroughness.ts';
import { createDictionaryDetector, type UnknownWords } from '../privacy/dictionary.ts';
import { createModelDetector, type AskModel } from '../privacy/model-detector.ts';
import type { Detector } from '../privacy/types.ts';
import { DetectSetupError } from './detect-error.ts';
import { createDetectWork, DETECTORS, type DetectWork } from './detect.ts';

export const PRIVACY_MODEL_ID = DEFAULT_CORRECTOR_ID;
export const THOROUGH_PRIVACY_MODEL_ID = STRONGER_CORRECTOR_ID;

const GIB = 1024 ** 3;
export const THOROUGH_MIN_RAM_BYTES = 15 * GIB;

export const PRIVACY_MODEL_MISSING =
  'Zum Entfernen des Personenbezugs braucht Rotstift das lokale Modell Gemma 4 E2B, auch wenn die Korrektur in der Cloud läuft. Es ist noch nicht eingerichtet. Bitte in den Einstellungen bei „Inhalt und Form“ einrichten. Von dieser Arbeit wurde nichts gesendet.';

export interface PrivacyModels {
  readonly models: readonly string[];
  readonly sensitiveModel: string;
}

export interface PlanInput {
  readonly thoroughness: Thoroughness | null;
  readonly totalRamBytes: number | null;
  readonly mainReady: boolean;
  readonly thoroughReady: boolean;
}

export function planPrivacyModels(input: PlanInput): PrivacyModels | null {
  if (!input.mainReady) return null;
  const thorough =
    (input.thoroughness === 'thorough' || input.thoroughness === 'veryThorough') &&
    input.totalRamBytes !== null &&
    input.totalRamBytes >= THOROUGH_MIN_RAM_BYTES &&
    input.thoroughReady;
  return thorough
    ? {
        models: [PRIVACY_MODEL_ID, THOROUGH_PRIVACY_MODEL_ID],
        sensitiveModel: THOROUGH_PRIVACY_MODEL_ID,
      }
    : { models: [PRIVACY_MODEL_ID], sensitiveModel: PRIVACY_MODEL_ID };
}

export function expectedPrivacyModels(
  choice: StepChoice,
  totalRamBytes: number | null,
): readonly AnyModelInfo[] {
  const plan = planPrivacyModels({
    thoroughness: thoroughnessOf(choice),
    totalRamBytes,
    mainReady: true,
    thoroughReady: true,
  });
  return (plan?.models ?? []).flatMap((id) => findCorrector(id) ?? []);
}

async function ready(client: ModelClient, modelId: string): Promise<boolean> {
  try {
    return (await client.status(modelId)).state === 'ready';
  } catch {
    return false;
  }
}

async function localThoroughness(client: ModelClient): Promise<Thoroughness | null> {
  const [transcriber, corrector, reviewer] = await Promise.all([
    client.selection(),
    client.correctorSelection(),
    client.reviewerSelection(),
  ]);
  return thoroughnessOf({
    transcriber: transcriber ?? DEFAULT_MODEL_ID,
    corrector: corrector ?? DEFAULT_CORRECTOR_ID,
    reviewer: reviewer ?? DEFAULT_REVIEWER_ID,
    secondReading: loadSecondReading(),
  });
}

export async function choosePrivacyModels(client: ModelClient): Promise<PrivacyModels | null> {
  const [thoroughness, hardware, mainReady, thoroughReady] = await Promise.all([
    localThoroughness(client).catch(() => null),
    client.hardware().catch(() => null),
    ready(client, PRIVACY_MODEL_ID),
    ready(client, THOROUGH_PRIVACY_MODEL_ID),
  ]);
  return planPrivacyModels({
    thoroughness,
    totalRamBytes: hardware?.totalRamBytes ?? null,
    mainReady,
    thoroughReady,
  });
}

export function engineAsk(
  engine: LlmEngine = sharedEngine(),
  llm: Pick<LlmClient, 'complete'> = createLlmClient(),
): AskModel {
  return async (modelId, request, signal) => {
    const model = findCorrector(modelId);
    if (model === undefined) throw new DetectSetupError(PRIVACY_MODEL_MISSING);
    const lease = await engine.acquire(model, signal);
    try {
      return (await llm.complete(request, { signal })).text;
    } finally {
      lease.release();
    }
  };
}

export function tauriUnknownWords(invoke: Invoke): UnknownWords {
  return async (words, signal) => {
    signal.throwIfAborted();
    return new Set(await invoke<string[]>('privacy_unknown_words', { words }));
  };
}

export interface LocalDetectorDeps {
  readonly client: ModelClient;
  readonly unknownWords: UnknownWords;
  readonly ask?: AskModel;
  readonly engine?: Pick<LlmEngine, 'loadedModel'>;
}

export function localDetectors(deps: LocalDetectorDeps): () => Promise<readonly Detector[]> {
  const engine = deps.engine ?? sharedEngine();
  const ask = deps.ask ?? engineAsk();
  return async () => {
    const chosen = await choosePrivacyModels(deps.client);
    if (chosen === null) throw new DetectSetupError(PRIVACY_MODEL_MISSING);
    return [
      ...DETECTORS,
      createDictionaryDetector(deps.unknownWords),
      createModelDetector({ ...chosen, ask, loaded: () => engine.loadedModel() }),
    ];
  };
}

export function appDetectWork(): DetectWork | undefined {
  const client = browserModelClient();
  if (client === null) return undefined;
  return createDetectWork(localDetectors({ client, unknownWords: tauriUnknownWords(tauriInvoke) }));
}
