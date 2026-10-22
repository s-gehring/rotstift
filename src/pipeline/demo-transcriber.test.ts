import { describe, expect, it } from 'vitest';
import { createDemoTranscriber, DEMO_MARKER } from './demo-transcriber.ts';

const png = new Blob(['png']);
const known = new Blob(['known']);
const recognize = (blob: Blob) =>
  Promise.resolve(blob === known ? { lines: ['Echte Zeile', '~~gestrichen~~ Zeile'] } : null);

describe('createDemoTranscriber', () => {
  it('labels every text as demo text', async () => {
    const demo = createDemoTranscriber({ delayMs: 0, failEvery: 0 });
    for (let call = 0; call < 4; call += 1) {
      const result = await demo.transcribe(png, new AbortController().signal);
      expect(result.ok && result.lines[0]).toContain(DEMO_MARKER);
    }
  });

  it('fails on every nth call so retries can be tried', async () => {
    const demo = createDemoTranscriber({ delayMs: 0, failEvery: 2 });
    const signal = new AbortController().signal;
    const results = [
      await demo.transcribe(png, signal),
      await demo.transcribe(png, signal),
      await demo.transcribe(png, signal),
    ];
    expect(results.map((result) => result.ok)).toEqual([true, false, true]);
  });

  it('reports cancellation when aborted while waiting', async () => {
    const demo = createDemoTranscriber({ delayMs: 10_000 });
    const controller = new AbortController();
    const pending = demo.transcribe(png, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ ok: false, error: { kind: 'cancelled' } });
  });

  it('reports cancellation for an already aborted signal', async () => {
    const demo = createDemoTranscriber({ delayMs: 10_000 });
    expect(await demo.transcribe(png, AbortSignal.abort())).toEqual({
      ok: false,
      error: { kind: 'cancelled' },
    });
  });

  it('returns the transcript of a recognized page without counting it as a call', async () => {
    const demo = createDemoTranscriber({ delayMs: 0, failEvery: 2, recognize });
    const signal = new AbortController().signal;
    for (let call = 0; call < 3; call += 1) {
      expect(await demo.transcribe(known, signal)).toEqual({
        ok: true,
        lines: ['Echte Zeile', '~~gestrichen~~ Zeile'],
      });
    }
    const results = [await demo.transcribe(png, signal), await demo.transcribe(png, signal)];
    expect(results.map((result) => result.ok)).toEqual([true, false]);
  });
});
