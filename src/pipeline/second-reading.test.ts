import { describe, expect, it, vi } from 'vitest';
import { withSecondReading } from './second-reading.ts';
import type { PageTranscriber, TranscribeResult } from './transcriber.ts';

const png = new Blob(['x'], { type: 'image/png' });

function fake(result: TranscribeResult) {
  return {
    transcribe: vi.fn<PageTranscriber['transcribe']>(() => Promise.resolve(result)),
    recover: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  };
}

describe('withSecondReading', () => {
  it('reads with the first model only until a second reading is asked for', async () => {
    const primary = fake({ ok: true, lines: ['Der Hunt'] });
    const second = fake({ ok: true, lines: ['Der Hund'] });
    const reader = withSecondReading(primary, second);
    const signal = new AbortController().signal;
    expect(await reader.transcribe(png, signal)).toEqual({ ok: true, lines: ['Der Hunt'] });
    expect(second.transcribe).not.toHaveBeenCalled();
    expect(await reader.secondRead(png, signal)).toEqual({ ok: true, lines: ['Der Hund'] });
    expect(primary.transcribe).toHaveBeenCalledOnce();
    expect(second.transcribe).toHaveBeenCalledWith(png, signal, undefined);
  });

  it('passes the failure of the second reading on', async () => {
    const failed = fake({ ok: false, error: { kind: 'failed', message: 'kaputt' } });
    const reader = withSecondReading(fake({ ok: true, lines: [] }), failed);
    expect(await reader.secondRead(png, new AbortController().signal)).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'kaputt' },
    });
  });

  it('recovers both models after a stall', async () => {
    const primary = fake({ ok: true, lines: [] });
    const second = fake({ ok: true, lines: [] });
    await withSecondReading(primary, second).recover();
    expect(primary.recover).toHaveBeenCalledOnce();
    expect(second.recover).toHaveBeenCalledOnce();
  });
});
