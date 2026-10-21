import { describe, expect, it, vi } from 'vitest';
import { withStruckWords, type StruckWordFinder } from './struck-words.ts';
import type { PageTranscriber, TranscribeResult } from './transcriber.ts';

function transcriber(result: TranscribeResult): PageTranscriber {
  return { transcribe: () => Promise.resolve(result) };
}

const PNG = new Blob(['png']);
const signal = new AbortController().signal;

describe('withStruckWords', () => {
  it('marks the struck words the finder reports', async () => {
    const find = vi.fn<StruckWordFinder>(() => Promise.resolve([[1], [], [0, 2]]));
    const wrapped = withStruckWords(
      transcriber({ ok: true, lines: ['Ich gehe ging', 'nach', 'Haus Hause heim'] }),
      find,
    );
    await expect(wrapped.transcribe(PNG, signal)).resolves.toMatchObject({
      ok: true,
      lines: ['Ich ~~gehe~~ ging', 'nach', '~~Haus~~ Hause ~~heim~~'],
    });
    expect(find).toHaveBeenCalledWith(PNG, ['Ich gehe ging', 'nach', 'Haus Hause heim']);
  });

  it('keeps the transcription when the finder fails', async () => {
    const result: TranscribeResult = { ok: true, lines: ['Ich gehe'] };
    const wrapped = withStruckWords(transcriber(result), () => Promise.reject(new Error('x')));
    await expect(wrapped.transcribe(PNG, signal)).resolves.toBe(result);
  });

  it('does not look for strikes after a failed transcription', async () => {
    const find = vi.fn<StruckWordFinder>(() => Promise.resolve([]));
    const result: TranscribeResult = { ok: false, error: { kind: 'cancelled' } };
    await expect(withStruckWords(transcriber(result), find).transcribe(PNG, signal)).resolves.toBe(
      result,
    );
    expect(find).not.toHaveBeenCalled();
  });
});
