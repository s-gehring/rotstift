import {
  ALL_MODELS,
  DEFAULT_CORRECTOR_ID,
  DEFAULT_MODEL_ID,
  DEFAULT_REVIEWER_ID,
  SECOND_READER_ID,
  type AnyModelInfo,
} from './registry.ts';
import { diskSlowdown } from './speed.ts';

export type Thoroughness = 'fast' | 'thorough' | 'veryThorough';

export interface StepChoice {
  readonly transcriber: string | null;
  readonly corrector: string | null;
  readonly reviewer: string | null;
  readonly secondReading: boolean;
}

export interface Level {
  readonly transcriber: string;
  readonly corrector: string;
  readonly reviewer: string;
  readonly secondReading: boolean;
}

export const STRONGER_CORRECTOR_ID = 'gemma-4-e4b-q4';
export const LARGEST_CORRECTOR_ID = 'gemma-4-26b-a4b-q4';

export const THOROUGHNESS: readonly Thoroughness[] = ['fast', 'thorough', 'veryThorough'];

export const LEVELS: Readonly<Record<Thoroughness, Level>> = {
  fast: {
    transcriber: DEFAULT_MODEL_ID,
    corrector: DEFAULT_CORRECTOR_ID,
    reviewer: DEFAULT_REVIEWER_ID,
    secondReading: false,
  },
  thorough: {
    transcriber: DEFAULT_MODEL_ID,
    corrector: STRONGER_CORRECTOR_ID,
    reviewer: DEFAULT_REVIEWER_ID,
    secondReading: true,
  },
  veryThorough: {
    transcriber: DEFAULT_MODEL_ID,
    corrector: LARGEST_CORRECTOR_ID,
    reviewer: DEFAULT_REVIEWER_ID,
    secondReading: true,
  },
};

export const THOROUGHNESS_NAME: Readonly<Record<Thoroughness, string>> = {
  fast: 'Schnell',
  thorough: 'Gründlich',
  veryThorough: 'Sehr gründlich',
};

export function thoroughnessOf(choice: StepChoice): Thoroughness | null {
  return (
    THOROUGHNESS.find((level) => {
      const wanted = LEVELS[level];
      return (
        choice.transcriber === wanted.transcriber &&
        choice.corrector === wanted.corrector &&
        choice.reviewer === wanted.reviewer &&
        choice.secondReading === wanted.secondReading
      );
    }) ?? null
  );
}

export function levelModels(level: Thoroughness): AnyModelInfo[] {
  const { transcriber, corrector, reviewer, secondReading } = LEVELS[level];
  const ids = [transcriber, corrector, reviewer, ...(secondReading ? [SECOND_READER_ID] : [])];
  return ALL_MODELS.filter((model) => ids.includes(model.id));
}

const MUCH_SLOWER = 2;

export function levelMuchSlower(level: Thoroughness, totalRamBytes: number | null): boolean {
  return levelModels(level).some((model) => diskSlowdown(model, totalRamBytes) >= MUCH_SLOWER);
}

export const SECOND_READING_STORAGE_KEY = 'rotstift.second-reading';

export type SecondReadingStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): SecondReadingStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadSecondReading(
  storage: SecondReadingStorage | null = defaultStorage(),
): boolean {
  try {
    return storage?.getItem(SECOND_READING_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function saveSecondReading(
  enabled: boolean,
  storage: SecondReadingStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(SECOND_READING_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    return;
  }
}
