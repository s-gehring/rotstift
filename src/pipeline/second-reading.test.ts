import { describe, expect, it, vi } from 'vitest';
import type { PageReading } from '../correction/uncertain-reading.ts';
import { withSecondReading } from './second-reading.ts';
import type { PageTranscriber, TranscribeResult } from './transcriber.ts';

const png = new Blob(['x'], { type: 'image/png' });

const reading: PageReading = {
  uncertainBelow: 0.95,
  lines: [
    [
      { text: 'Der', confidence: 0.99 },
      { text: 'Hunt', confidence: 0.9 },
    ],
  ],
};

function fake(result: TranscribeResult, startupMs?: number) {
  return {
    transcribe: vi.fn<PageTranscriber['transcribe']>(() =>
      Promise.resolve(result.ok && startupMs !== undefined ? { ...result, startupMs } : result),
    ),
    recover: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  };
}

describe('withSecondReading', () => {
  it('reads the same page a second time and keeps only confirmed words sure', async () => {
    const primary = fake({ ok: true, lines: ['Der Hunt'], reading }, 1200);
    const second = fake({ ok: true, lines: ['Der Hund'] }, 800);
    const result = await withSecondReading(primary, second).transcribe(
      png,
      new AbortController().signal,
    );
    expect(second.transcribe).toHaveBeenCalledWith(png, expect.any(AbortSignal), undefined);
    expect(result).toMatchObject({
      ok: true,
      lines: ['Der Hunt'],
      startupMs: 2000,
      reading: { uncertainBelow: 1, lines: [[{ confidence: 1 }, { confidence: 0 }]] },
    });
  });

  it('skips the second reading when the first has no reading confidence', async () => {
    const primary = fake({ ok: true, lines: ['Der Hunt'] });
    const second = fake({ ok: true, lines: ['Der Hund'] });
    const result = await withSecondReading(primary, second).transcribe(
      png,
      new AbortController().signal,
    );
    expect(second.transcribe).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, lines: ['Der Hunt'] });
  });

  it('keeps the first reading when the second fails, but passes a cancellation on', async () => {
    const primary = fake({ ok: true, lines: ['Der Hunt'], reading });
    const failed = fake({ ok: false, error: { kind: 'failed', message: 'kaputt' } });
    expect(
      await withSecondReading(primary, failed).transcribe(png, new AbortController().signal),
    ).toEqual({ ok: true, lines: ['Der Hunt'], reading });
    const cancelled = fake({ ok: false, error: { kind: 'cancelled' } });
    expect(
      await withSecondReading(primary, cancelled).transcribe(png, new AbortController().signal),
    ).toEqual({ ok: false, error: { kind: 'cancelled' } });
  });

  it('recovers both models after a stall', async () => {
    const primary = fake({ ok: true, lines: [] });
    const second = fake({ ok: true, lines: [] });
    await withSecondReading(primary, second).recover();
    expect(primary.recover).toHaveBeenCalledOnce();
    expect(second.recover).toHaveBeenCalledOnce();
  });
});
