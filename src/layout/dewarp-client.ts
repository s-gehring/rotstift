import { applyDewarp, planDewarp, type DewarpPlan } from './dewarp.ts';
import type { DewarpRequest, DewarpResponse, PixelBuffer } from './dewarp-protocol.ts';
import type { RgbaImage } from './types.ts';

export interface DewarpWorkerLike {
  addEventListener(
    type: 'message' | 'messageerror' | 'error',
    listener: (event: Event) => void,
  ): void;
  postMessage(message: DewarpRequest, transfer: Transferable[]): void;
  terminate(): void;
}

export interface Straightener {
  plan(image: RgbaImage): Promise<DewarpPlan | null>;
  apply(image: RgbaImage, plan: DewarpPlan): Promise<RgbaImage>;
  dispose(): void;
}

type Answer = DewarpResponse & { ok: true };

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

interface Pending {
  readonly resolve: (response: Answer) => void;
  readonly reject: (error: Error) => void;
}

function toBuffer(image: RgbaImage): PixelBuffer {
  const copy = new Uint8ClampedArray(image.data);
  return { width: image.width, height: image.height, buffer: copy.buffer };
}

function defaultWorkerFactory(): (() => DewarpWorkerLike) | null {
  if (typeof Worker === 'undefined') return null;
  return () => new Worker(new URL('./dewarp.worker.ts', import.meta.url), { type: 'module' });
}

export function createStraightener(
  factory: (() => DewarpWorkerLike) | null = defaultWorkerFactory(),
): Straightener {
  let worker: DewarpWorkerLike | null = null;
  let counter = 0;
  const pending = new Map<number, Pending>();

  const failAll = (error: Error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };

  const start = (create: () => DewarpWorkerLike): DewarpWorkerLike => {
    const created = create();
    created.addEventListener('message', (event) => {
      if (!(event instanceof MessageEvent)) return;
      const response: DewarpResponse = event.data;
      const entry = pending.get(response.id);
      if (entry === undefined) return;
      pending.delete(response.id);
      if (response.ok) entry.resolve(response);
      else entry.reject(new Error(response.message));
    });
    created.addEventListener('messageerror', () => {
      failAll(new Error('dewarp worker sent an unreadable message'));
    });
    created.addEventListener('error', (event) => {
      const detail = 'message' in event && typeof event.message === 'string' ? event.message : '';
      failAll(new Error(detail || 'dewarp worker failed'));
    });
    return created;
  };

  const request = (create: () => DewarpWorkerLike, message: WithoutId<DewarpRequest>) => {
    worker ??= start(create);
    counter += 1;
    const id = counter;
    return new Promise<Answer>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker?.postMessage({ ...message, id }, [message.image.buffer]);
    });
  };

  return {
    async plan(image) {
      if (factory === null) return planDewarp(image);
      const response = await request(factory, { task: 'plan', image: toBuffer(image) });
      if (!('plan' in response)) throw new Error('dewarp worker answered the wrong task');
      return response.plan;
    },
    async apply(image, plan) {
      if (factory === null) return applyDewarp(image, plan);
      const response = await request(factory, { task: 'apply', image: toBuffer(image), plan });
      if (!('image' in response)) throw new Error('dewarp worker answered the wrong task');
      const { width, height, buffer } = response.image;
      return { width, height, data: new Uint8ClampedArray(buffer) };
    },
    dispose() {
      failAll(new Error('straightener disposed'));
    },
  };
}

let shared: Straightener | null = null;

export function sharedStraightener(): Straightener {
  shared ??= createStraightener();
  return shared;
}
