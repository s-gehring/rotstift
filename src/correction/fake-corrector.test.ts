import { describe, expect, it } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { createFakeCorrector } from './fake-corrector.ts';

describe('createFakeCorrector', () => {
  it('returns the scripted text and records the call', async () => {
    const corrector = createFakeCorrector('Hallo Welt');
    const result = await corrector.correct(['Hallo Welt'], DEUTSCH, new AbortController().signal);
    expect(result).toEqual({ ok: true, correctedText: 'Hallo Welt' });
    expect(corrector.calls).toEqual([{ lines: ['Hallo Welt'], profile: DEUTSCH }]);
  });

  it('computes the text from a function', async () => {
    const corrector = createFakeCorrector((lines) => lines.join(' ').toUpperCase());
    const result = await corrector.correct(['a', 'b'], DEUTSCH, new AbortController().signal);
    expect(result).toEqual({ ok: true, correctedText: 'A B' });
  });

  it('returns a scripted error', async () => {
    const corrector = createFakeCorrector({ error: { kind: 'unavailable', message: 'weg' } });
    const result = await corrector.correct(['x'], DEUTSCH, new AbortController().signal);
    expect(result).toEqual({ ok: false, error: { kind: 'unavailable', message: 'weg' } });
  });

  it('reports cancellation for an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await createFakeCorrector('x').correct(['x'], DEUTSCH, controller.signal);
    expect(result).toEqual({ ok: false, error: { kind: 'cancelled' } });
  });
});
