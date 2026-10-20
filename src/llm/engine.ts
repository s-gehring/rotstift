import type { AnyModelInfo } from '../models/registry.ts';
import type { EngineMonitor, EnginePhase } from '../pipeline/transcriber.ts';
import { createLlmClient, LlmCallError, type LlmClient } from './client.ts';

export type EngineClient = Pick<LlmClient, 'status' | 'startModel' | 'complete'> & {
  readonly stop?: () => unknown;
};

export type EngineModel = Pick<AnyModelInfo, 'id' | 'files'>;

export interface EngineLease {
  readonly startupMs: number;
  release(): void;
}

export interface LlmEngine {
  acquire(model: EngineModel, signal: AbortSignal): Promise<EngineLease>;
  monitor(modelId: string): EngineMonitor;
  markFailed(modelId: string): void;
  reset(): Promise<void>;
  loadedModel(): string | null;
}

interface Waiter {
  readonly model: EngineModel;
  readonly began: number;
  readonly resolve: (lease: EngineLease) => void;
  readonly reject: (error: unknown) => void;
  detach: () => void;
}

const cancelled = () => new LlmCallError({ kind: 'cancelled' });

export function createLlmEngine(
  client: EngineClient,
  now: () => number = () => performance.now(),
): LlmEngine {
  const listeners = new Set<() => void>();
  const queue: Waiter[] = [];
  let loaded: string | null = null;
  let phase: EnginePhase = 'idle';
  let holders = 0;
  let epoch = 0;
  let ensuring: number | null = null;

  const set = (modelId: string | null, next: EnginePhase) => {
    if (loaded === modelId && phase === next) return;
    loaded = modelId;
    phase = next;
    for (const listener of listeners) listener();
  };

  const lease = (startupMs: number): EngineLease => {
    const own = epoch;
    let released = false;
    holders += 1;
    return {
      startupMs,
      release() {
        if (released) return;
        released = true;
        if (own !== epoch) return;
        holders -= 1;
        pump();
      },
    };
  };

  const settleHead = (modelId: string, settle: (waiter: Waiter) => void) => {
    while (queue[0]?.model.id === modelId) {
      const waiter = queue.shift();
      if (waiter === undefined) return;
      waiter.detach();
      settle(waiter);
    }
  };

  const ensure = async (model: EngineModel) => {
    const own = epoch;
    let switched = false;
    try {
      const status = await client.status();
      if (own !== epoch) return;
      const serving = status.state === 'ready' && status.model === model.files.model.name;
      if (!serving) {
        switched = true;
        set(model.id, 'starting');
        if (status.state === 'ready' || status.state === 'starting') await client.stop?.();
        const started = await client.startModel(model.id);
        if (own !== epoch) return;
        if (started.state !== 'ready') {
          throw new LlmCallError(started.state === 'failed' ? started.error : { kind: 'notReady' });
        }
      }
      set(model.id, 'ready');
      const at = now();
      settleHead(model.id, (waiter) => {
        waiter.resolve(lease(switched ? at - waiter.began : 0));
      });
    } catch (error) {
      if (own !== epoch) return;
      set(model.id, 'failed');
      settleHead(model.id, (waiter) => {
        waiter.reject(error);
      });
    }
  };

  function pump() {
    if (ensuring === epoch) return;
    const head = queue[0];
    if (head === undefined) return;
    if (holders > 0) {
      if (head.model.id === loaded && phase === 'ready') {
        settleHead(head.model.id, (waiter) => {
          waiter.resolve(lease(0));
        });
      }
      return;
    }
    const own = epoch;
    ensuring = own;
    void ensure(head.model).finally(() => {
      if (ensuring === own) ensuring = null;
      pump();
    });
  }

  return {
    acquire(model, signal) {
      if (signal.aborted) return Promise.reject(cancelled());
      return new Promise<EngineLease>((resolve, reject) => {
        const waiter: Waiter = { model, began: now(), resolve, reject, detach: () => undefined };
        const onAbort = () => {
          const index = queue.indexOf(waiter);
          if (index === -1) return;
          queue.splice(index, 1);
          reject(cancelled());
          pump();
        };
        waiter.detach = () => {
          signal.removeEventListener('abort', onAbort);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        queue.push(waiter);
        pump();
      });
    },

    monitor(modelId) {
      return {
        getPhase: () => (loaded === modelId ? phase : 'idle'),
        subscribe: (listener) => {
          listeners.add(listener);
          return () => void listeners.delete(listener);
        },
      };
    },

    markFailed(modelId) {
      if (loaded === modelId) set(modelId, 'failed');
    },

    async reset() {
      epoch += 1;
      holders = 0;
      set(null, 'idle');
      await Promise.resolve(client.stop?.()).catch(() => undefined);
      pump();
    },

    loadedModel: () => loaded,
  };
}

let shared: LlmEngine | null = null;

export function sharedEngine(): LlmEngine {
  shared ??= createLlmEngine(createLlmClient());
  return shared;
}
