import { describe, expect, it } from 'vitest';
import { describeError } from './transcriber.ts';

describe('describeError', () => {
  it('puts technical details in parentheses instead of after a colon', () => {
    expect(describeError({ kind: 'failed', message: 'HTTP 500: Server kaputt.' })).toBe(
      'Die Seite konnte nicht erkannt werden (HTTP 500: Server kaputt).',
    );
    expect(describeError({ kind: 'unavailable', message: 'Modell fehlt.' })).toBe(
      'Die Texterkennung ist nicht verfügbar (Modell fehlt).',
    );
  });

  it('describes a cancelled recognition', () => {
    expect(describeError({ kind: 'cancelled' })).toBe('Die Erkennung wurde abgebrochen.');
  });
});
