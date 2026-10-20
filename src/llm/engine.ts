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

export interface AcquireEvents {
  readonly onWaiting?: () => void;
  readonly onStarting?: () => void;
}

export interface LlmEngine {
  acquire(model: EngineModel, signal: AbortSignal, events?: AcquireEvents): Promise<EngineLease>;
  monitor(modelId: string): EngineMonitor;
  markFailed(modelId: string): void;
  reset(modelId?: string): Promise<void>;
  loadedModel(): string | null;
}

interface Waiter {
  readonly model: EngineModel;
  readonly events: AcquireEvents;
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
  let holder = false;
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
    holder = true;
    return {
      startupMs,
      release() {
        if (released) return;
        released = true;
        if (own !== epoch) return;
        holder = false;
        pump();
      },
    };
  };

  const take = (waiter: Waiter): boolean => {
    if (queue[0] !== waiter) return false;
    queue.shift();
    waiter.detach();
    return true;
  };

  const ensure = async (waiter: Waiter) => {
    const { model } = waiter;
    const own = epoch;
    let startupMs = 0;
    try {
      const status = await client.status();
      if (own !== epoch) return;
      const serving = status.state === 'ready' && status.model === model.files.model.name;
      if (!serving) {
        const began = now();
        set(model.id, 'starting');
        if (queue[0] === waiter) waiter.events.onStarting?.();
        if (status.state === 'ready' || status.state === 'starting') await client.stop?.();
        const started = await client.startModel(model.id);
        if (own !== epoch) return;
        if (started.state !== 'ready') {
          throw new LlmCallError(started.state === 'failed' ? started.error : { kind: 'notReady' });
        }
        startupMs = now() - began;
      }
      set(model.id, 'ready');
      if (take(waiter)) waiter.resolve(lease(startupMs));
    } catch (error) {
      if (own !== epoch) return;
      set(model.id, 'failed');
      for (let failed = queue[0]; failed?.model.id === model.id; failed = queue[0]) {
        take(failed);
        failed.reject(error);
      }
    }
  };

  function pump() {
    if (ensuring === epoch || holder) return;
    const head = queue[0];
    if (head === undefined) return;
    const own = epoch;
    ensuring = own;
    void ensure(head).finally(() => {
      if (ensuring === own) ensuring = null;
      pump();
    });
  }

  return {
    acquire(model, signal, events = {}) {
      if (signal.aborted) return Promise.reject(cancelled());
      return new Promise<EngineLease>((resolve, reject) => {
        const waiter: Waiter = { model, events, resolve, reject, detach: () => undefined };
        const onAbort = () => {
          const index = queue.indexOf(waiter);
          if (index === -1) return;
          queue.splice(index, 1);
          waiter.detach();
          reject(cancelled());
          pump();
        };
        waiter.detach = () => {
          signal.removeEventListener('abort', onAbort);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        const busy = queue.length > 0 || holder || ensuring === epoch;
        queue.push(waiter);
        if (busy) events.onWaiting?.();
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

    async reset(modelId) {
      if (modelId !== undefined && loaded !== null && loaded !== modelId) return;
      epoch += 1;
      holder = false;
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
