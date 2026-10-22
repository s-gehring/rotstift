import { describe, expect, it } from 'vitest';
import { createStraightener, type DewarpWorkerLike } from './dewarp-client.ts';
import type { DewarpPlan } from './dewarp.ts';
import type { DewarpRequest, DewarpResponse } from './dewarp-protocol.ts';

const PLAN: DewarpPlan = {
  width: 1,
  height: 1,
  columns: 2,
  rows: 2,
  mesh: [0, 0, 1, 0, 0, 1, 1, 1],
};

const PIXELS = { width: 2, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]) };

class FakeWorker extends EventTarget implements DewarpWorkerLike {
  readonly requests: DewarpRequest[] = [];
  readonly transfers: Transferable[][] = [];
  terminated = false;
  reply: (request: DewarpRequest) => DewarpResponse | null = (request) =>
    request.task === 'plan'
      ? { id: request.id, ok: true, plan: PLAN }
      : { id: request.id, ok: true, image: { ...request.image } };

  postMessage(message: DewarpRequest, transfer: Transferable[]): void {
    this.requests.push(message);
    this.transfers.push(transfer);
    const response = this.reply(message);
    if (response !== null) this.dispatchEvent(new MessageEvent('message', { data: response }));
  }

  terminate(): void {
    this.terminated = true;
  }

  fail(message: string): void {
    this.dispatchEvent(Object.assign(new Event('error'), { message }));
  }
}

describe('createStraightener', () => {
  it('plans and applies in the worker with copies of the pixels', async () => {
    const worker = new FakeWorker();
    const straightener = createStraightener(() => worker);
    await expect(straightener.plan(PIXELS)).resolves.toEqual(PLAN);
    const applied = await straightener.apply(PIXELS, PLAN);
    expect(Array.from(applied.data)).toEqual(Array.from(PIXELS.data));
    expect(worker.requests.map((request) => request.task)).toEqual(['plan', 'apply']);
    expect(worker.transfers.every((transfer) => transfer.length === 1)).toBe(true);
    expect(PIXELS.data.byteLength).toBe(8);
  });

  it('rejects when the worker reports an error or crashes', async () => {
    const worker = new FakeWorker();
    worker.reply = (request) => ({ id: request.id, ok: false, message: 'kaputt' });
    await expect(createStraightener(() => worker).plan(PIXELS)).rejects.toThrow('kaputt');
    const silent = new FakeWorker();
    silent.reply = () => null;
    const straightener = createStraightener(() => silent);
    const pending = straightener.plan(PIXELS);
    silent.fail('abgestürzt');
    await expect(pending).rejects.toThrow('abgestürzt');
    expect(silent.terminated).toBe(true);
  });

  it('works without a worker', async () => {
    const straightener = createStraightener(null);
    await expect(straightener.plan(PIXELS)).resolves.toBeNull();
    const applied = await straightener.apply(PIXELS, PLAN);
    expect(Array.from(applied.data)).toEqual(Array.from(PIXELS.data));
  });
});
