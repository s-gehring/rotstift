import { useSyncExternalStore } from 'react';
import type { EngineMonitor, EnginePhase } from '../pipeline/transcriber.ts';
import type { ReviewRun } from './review-flow.ts';

export interface ReviewEngine {
  readonly transcriber: EnginePhase;
  readonly corrector: EnginePhase;
}

export const IDLE_ENGINE: ReviewEngine = { transcriber: 'idle', corrector: 'idle' };

const NO_ENGINE: EngineMonitor = {
  getPhase: () => 'idle',
  subscribe: () => () => undefined,
};

export function useMonitorPhase(monitor: EngineMonitor | undefined): EnginePhase {
  const engine = monitor ?? NO_ENGINE;
  return useSyncExternalStore(engine.subscribe, engine.getPhase);
}

const LOADING_TEXT = {
  transcribing: 'Texterkennung wird geladen …',
  correcting: 'Korrekturmodell wird geladen …',
} as const;

const SWITCH_TEXT = 'Modellwechsel wird vorbereitet …';

export function engineText(run: ReviewRun, engine: ReviewEngine): string | null {
  if (run.phase === 'locating') return null;
  const [own, other] =
    run.phase === 'correcting'
      ? [engine.corrector, engine.transcriber]
      : [engine.transcriber, engine.corrector];
  if (own === 'starting') return LOADING_TEXT[run.phase];
  if (own === 'idle' && other !== 'idle') return SWITCH_TEXT;
  return null;
}
