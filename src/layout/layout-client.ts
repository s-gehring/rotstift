import { decodeImage } from './decode.ts';
import { locateLines } from './locate-lines.ts';
import type { LayoutImage, LayoutInput, LayoutRequest, LayoutResponse } from './protocol.ts';
import type { LayoutResult } from './types.ts';

export interface WorkerLike {
  addEventListener(
    type: 'message' | 'messageerror' | 'error',
    listener: (event: Event) => void,
  ): void;
  postMessage(message: LayoutRequest, transfer: Transferable[]): void;
  terminate(): void;
}

export interface LayoutLocator {
  locate(image: LayoutInput, lines: readonly string[]): Promise<LayoutResult>;
  dispose(): void;
}

interface Pending {
  readonly resolve: (result: LayoutResult) => void;
  readonly reject: (error: Error) => void;
}

function toMessageImage(image: LayoutInput): { image: LayoutImage; transfer: Transferable[] } {
  if (image instanceof Blob) return { image: { kind: 'blob', blob: image }, transfer: [] };
  const copy = new Uint8ClampedArray(image.data);
  return {
    image: { kind: 'pixels', width: image.width, height: image.height, buffer: copy.buffer },
    transfer: [copy.buffer],
  };
}

function defaultWorkerFactory(): (() => WorkerLike) | null {
  if (typeof Worker === 'undefined') return null;
  return () => new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
}

export function createLayoutLocator(
  factory: (() => WorkerLike) | null = defaultWorkerFactory(),
): LayoutLocator {
  let worker: WorkerLike | null = null;
  let counter = 0;
  const pending = new Map<number, Pending>();

  const failAll = (error: Error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };

  const start = (create: () => WorkerLike): WorkerLike => {
    const created = create();
    created.addEventListener('message', (event) => {
      if (!(event instanceof MessageEvent)) return;
      const response: LayoutResponse = event.data;
      const entry = pending.get(response.id);
      if (entry === undefined) return;
      pending.delete(response.id);
      if (response.ok) entry.resolve(response.result);
      else entry.reject(new Error(response.message));
    });
    created.addEventListener('messageerror', () => {
      failAll(new Error('layout worker sent an unreadable message'));
    });
    created.addEventListener('error', (event) => {
      const detail = 'message' in event && typeof event.message === 'string' ? event.message : '';
      failAll(new Error(detail || 'layout worker failed'));
    });
    return created;
  };

  return {
    locate(image, lines) {
      if (factory === null) {
        return decodeImage(image).then((pixels) => locateLines(pixels, lines));
      }
      worker ??= start(factory);
      counter += 1;
      const id = counter;
      const message = toMessageImage(image);
      return new Promise<LayoutResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker?.postMessage({ id, image: message.image, lines }, message.transfer);
      });
    },
    dispose() {
      failAll(new Error('layout locator disposed'));
    },
  };
}
