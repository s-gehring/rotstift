import { useSyncExternalStore } from 'react';
import type { EnginePhase, TranscriberStatus } from './transcriber.ts';

const NO_ENGINE = {
  getPhase: (): EnginePhase => 'idle',
  subscribe: () => () => undefined,
};

export function useEnginePhase(status: TranscriberStatus | null): EnginePhase {
  const engine = (status?.state === 'ready' ? status.engine : undefined) ?? NO_ENGINE;
  return useSyncExternalStore(engine.subscribe, engine.getPhase);
}
