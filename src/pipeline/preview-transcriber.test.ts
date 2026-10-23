import { describe, expect, it } from 'vitest';
import { createPreviewTranscriber, PREVIEW_MARKER } from './preview-transcriber.ts';

const png = new Blob(['png']);

describe('createPreviewTranscriber', () => {
  it('labels every text as preview text', async () => {
    const preview = createPreviewTranscriber({ delayMs: 0, failEvery: 0 });
    for (let call = 0; call < 4; call += 1) {
      const result = await preview.transcribe(png, new AbortController().signal);
      expect(result.ok && result.lines.every((line) => line.startsWith(PREVIEW_MARKER))).toBe(true);
    }
  });

  it('returns the requested number of lines', async () => {
    const preview = createPreviewTranscriber({ delayMs: 0, failEvery: 0, lines: 3 });
    const result = await preview.transcribe(png, new AbortController().signal);
    expect(result.ok && result.lines).toHaveLength(3);
  });

  it('fails on every nth call so retries can be tried', async () => {
    const preview = createPreviewTranscriber({ delayMs: 0, failEvery: 2 });
    const signal = new AbortController().signal;
    const results = [
      await preview.transcribe(png, signal),
      await preview.transcribe(png, signal),
      await preview.transcribe(png, signal),
    ];
    expect(results.map((result) => result.ok)).toEqual([true, false, true]);
  });

  it('reports cancellation when aborted while waiting', async () => {
    const preview = createPreviewTranscriber({ delayMs: 10_000 });
    const controller = new AbortController();
    const pending = preview.transcribe(png, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ ok: false, error: { kind: 'cancelled' } });
  });

  it('reports cancellation for an already aborted signal', async () => {
    const preview = createPreviewTranscriber({ delayMs: 10_000 });
    expect(await preview.transcribe(png, AbortSignal.abort())).toEqual({
      ok: false,
      error: { kind: 'cancelled' },
    });
  });
});
