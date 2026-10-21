import { describe, expect, it } from 'vitest';
import {
  createLayoutLocator,
  observeLocate,
  type LayoutCounts,
  type LayoutLocator,
  type WorkerLike,
} from './layout-client.ts';
import type { LayoutRequest, LayoutResponse } from './protocol.ts';
import { renderPage, sampleLines } from './synthetic.ts';
import type { LayoutResult } from './types.ts';

const RESULT: LayoutResult = { lines: [null], skewDegrees: 0.5, detectedLines: 3 };

class FakeWorker extends EventTarget implements WorkerLike {
  readonly requests: LayoutRequest[] = [];
  readonly transfers: Transferable[][] = [];
  terminated = false;
  reply: (request: LayoutRequest) => LayoutResponse | null = (request) => ({
    id: request.id,
    ok: true,
    result: RESULT,
  });

  postMessage(message: LayoutRequest, transfer: Transferable[]): void {
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

const PIXELS = { width: 2, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]) };

describe('createLayoutLocator', () => {
  it('sends a copy of the pixels as a transferable and resolves with the worker result', async () => {
    const worker = new FakeWorker();
    const locator = createLayoutLocator(() => worker);
    await expect(locator.locate(PIXELS, ['Hallo'])).resolves.toEqual(RESULT);
    const image = worker.requests[0]?.image;
    expect(image?.kind).toBe('pixels');
    expect(worker.transfers[0]).toHaveLength(1);
    expect(PIXELS.data.buffer.byteLength).toBe(8);
    expect(worker.requests[0]?.lines).toEqual(['Hallo']);
  });

  it('sends a blob unchanged', async () => {
    const worker = new FakeWorker();
    const locator = createLayoutLocator(() => worker);
    const blob = new Blob(['x']);
    await locator.locate(blob, []);
    expect(worker.requests[0]?.image).toEqual({ kind: 'blob', blob });
    expect(worker.transfers[0]).toEqual([]);
  });

  it('rejects when the worker reports an error for the request', async () => {
    const worker = new FakeWorker();
    worker.reply = (request) => ({ id: request.id, ok: false, message: 'kaputt' });
    const locator = createLayoutLocator(() => worker);
    await expect(locator.locate(PIXELS, [])).rejects.toThrow('kaputt');
  });

  it('rejects pending requests when the worker crashes and starts a new one afterwards', async () => {
    const first = new FakeWorker();
    first.reply = () => null;
    const second = new FakeWorker();
    const workers = [first, second];
    const locator = createLayoutLocator(() => {
      const next = workers.shift();
      if (next === undefined) throw new Error('no worker left');
      return next;
    });
    const pending = locator.locate(PIXELS, []);
    first.fail('boom');
    await expect(pending).rejects.toThrow('boom');
    expect(first.terminated).toBe(true);
    await expect(locator.locate(PIXELS, [])).resolves.toEqual(RESULT);
  });

  it('rejects pending requests when a message cannot be deserialized', async () => {
    const worker = new FakeWorker();
    worker.reply = () => null;
    const locator = createLayoutLocator(() => worker);
    const pending = locator.locate(PIXELS, []);
    worker.dispatchEvent(new Event('messageerror'));
    await expect(pending).rejects.toThrow('unreadable');
    expect(worker.terminated).toBe(true);
  });

  it('terminates the worker on dispose and rejects what is pending', async () => {
    const worker = new FakeWorker();
    worker.reply = () => null;
    const locator = createLayoutLocator(() => worker);
    const pending = locator.locate(PIXELS, []);
    locator.dispose();
    await expect(pending).rejects.toThrow('disposed');
    expect(worker.terminated).toBe(true);
  });

  it('computes on the calling thread when workers are unavailable', async () => {
    const lines = sampleLines(2, 6);
    const page = renderPage({ width: 700, height: 600, pitch: 50, seed: 1, lines });
    const locator = createLayoutLocator(null);
    const result = await locator.locate(page.image, lines);
    expect(result.lines.filter((line) => line !== null)).toHaveLength(6);
  });

  it('asks the worker for struck words and rejects an answer for the wrong task', async () => {
    const worker = new FakeWorker();
    worker.reply = (request) =>
      request.task === 'struck'
        ? { id: request.id, ok: true, struck: [[1], []] }
        : { id: request.id, ok: true, result: RESULT };
    const locator = createLayoutLocator(() => worker);
    await expect(locator.struckWords(PIXELS, ['a b', 'c'])).resolves.toEqual([[1], []]);
    expect(worker.requests[0]?.task).toBe('struck');
    worker.reply = (request) => ({ id: request.id, ok: true, result: RESULT });
    await expect(locator.struckWords(PIXELS, ['a'])).rejects.toThrow('wrong task');
  });

  it('finds struck words on the calling thread when workers are unavailable', async () => {
    const lines = sampleLines(3, 6);
    const page = renderPage({
      width: 700,
      height: 600,
      pitch: 50,
      seed: 4,
      lines,
      struck: [[], [1]],
    });
    const struck = await createLayoutLocator(null).struckWords(page.image, lines);
    expect(struck[1]).toEqual([1]);
    expect(struck.filter((_, index) => index !== 1).flat()).toEqual([]);
  });
});

function fakeLocator(locate: LayoutLocator['locate']): LayoutLocator {
  return { locate, struckWords: () => Promise.resolve([]), dispose: () => undefined };
}

describe('observeLocate', () => {
  const box = { x: 0, y: 0, width: 10, height: 5 };
  const image = { width: 1, height: 1, data: new Uint8ClampedArray(4) };

  it('reports found, transcribed, assigned and roughly placed lines with the duration', async () => {
    const result: LayoutResult = {
      lines: [{ bbox: box, confidence: 0.9 }, { bbox: box, confidence: 0, rough: true }, null],
      skewDegrees: 0,
      detectedLines: 3,
    };
    const reports: [LayoutCounts | null, number][] = [];
    const times = [100, 340];
    const observed = observeLocate(
      fakeLocator(() => Promise.resolve(result)),
      (counts, ms) => reports.push([counts, ms]),
      () => times.shift() ?? 0,
    );
    expect(await observed.locate(image, ['eins', 'zwei', ' '])).toBe(result);
    expect(reports).toEqual([
      [{ foundLines: 3, transcriptLines: 2, assignedLines: 1, roughLines: 1 }, 240],
    ]);
  });

  it('reports a failed search and passes the error on', async () => {
    const reports: (LayoutCounts | null)[] = [];
    const observed = observeLocate(
      fakeLocator(() => Promise.reject(new Error('kaputt'))),
      (counts) => reports.push(counts),
    );
    await expect(observed.locate(image, ['eins'])).rejects.toThrow('kaputt');
    expect(reports).toEqual([null]);
  });
});
