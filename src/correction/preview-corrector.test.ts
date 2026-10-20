// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { correctPage } from './correct-page.ts';
import { createPreviewCorrector, previewCorrection } from './preview-corrector.ts';

const DEMO = [
  'Demo-Text: Dieser Text stammt nicht aus einer echten Erkennung.',
  'Am Montag sind wir mit der Klasse in den Wald ge-',
  'gangen und haben Blätter gesammelt.',
];

describe('previewCorrection', () => {
  it('changes the demo text so that marks appear', async () => {
    expect(previewCorrection(DEMO)).not.toBe(DEMO.join('\n'));
    const result = await correctPage({
      lines: DEMO,
      profile: DEUTSCH,
      corrector: createPreviewCorrector({ delayMs: 0 }),
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.statistics.errors).toBeGreaterThan(0);
  });
});

describe('createPreviewCorrector', () => {
  it('stops when cancelled', async () => {
    const abort = new AbortController();
    const pending = createPreviewCorrector({ delayMs: 10_000 }).correct(
      DEMO,
      DEUTSCH,
      abort.signal,
    );
    abort.abort();
    await expect(pending).resolves.toEqual({ ok: false, error: { kind: 'cancelled' } });
  });
});
