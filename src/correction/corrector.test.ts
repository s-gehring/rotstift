import { describe, expect, it } from 'vitest';
import { describeCorrectError } from './corrector.ts';

describe('describeCorrectError', () => {
  it('describes every error kind in German', () => {
    expect(describeCorrectError({ kind: 'cancelled' })).toBe('Die Korrektur wurde abgebrochen.');
    expect(describeCorrectError({ kind: 'unavailable', message: 'Modell fehlt.' })).toBe(
      'Die Korrektur ist nicht verfügbar (Modell fehlt).',
    );
    expect(describeCorrectError({ kind: 'failed', message: 'zu lang' })).toBe(
      'Der Text konnte nicht korrigiert werden (zu lang).',
    );
  });
});
