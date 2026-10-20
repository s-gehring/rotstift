import { describe, expect, it } from 'vitest';
import { decodedHeader, fakeInvoke } from './fake-invoke.ts';
import { saveFile } from './save-file.ts';

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff]);

const outcome = (result: unknown, fail = false) =>
  saveFile('pdf', BYTES, 'y', fakeInvoke(result, fail).invoke);

describe('saveFile', () => {
  it('sends the bytes untouched as the raw body with the metadata in headers', async () => {
    const { calls, invoke } = fakeInvoke(null);
    await saveFile('pdf', BYTES, 'Müller, Jörg (Wortzahl)', invoke);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('save_file');
    expect(calls[0]?.body).toBe(BYTES);
    expect(calls[0]?.headers).toEqual({
      'x-rotstift-kind': 'pdf',
      'x-rotstift-name': 'M%C3%BCller%2C%20J%C3%B6rg%20(Wortzahl)',
    });
    expect(decodedHeader(calls[0], 'x-rotstift-name')).toBe('Müller, Jörg (Wortzahl)');
  });

  it('never sends a path', async () => {
    const { calls, invoke } = fakeInvoke(null);
    await saveFile('csv', BYTES, 'Wortzahlen', invoke);
    expect(Object.keys(calls[0]?.headers ?? {})).toEqual(['x-rotstift-kind', 'x-rotstift-name']);
  });

  it('reports a cancelled dialog', async () => {
    expect(await outcome(null)).toEqual({ state: 'cancelled' });
  });

  it('reports the name of the saved file', async () => {
    expect(await outcome({ fileName: 'Klasse.pdf' })).toEqual({
      state: 'saved',
      fileName: 'Klasse.pdf',
    });
  });

  it('reports a file that already exists', async () => {
    expect(await outcome({ kind: 'alreadyExists', fileName: 'klasse.pdf' }, true)).toEqual({
      state: 'exists',
      fileName: 'klasse.pdf',
    });
  });

  it('reports any other failure', async () => {
    expect(await outcome('kaputt', true)).toEqual({ state: 'failed' });
    expect(await outcome({ kind: 'tooLarge' }, true)).toEqual({
      state: 'failed',
      reason: 'tooLarge',
    });
    expect(await outcome({ kind: 'invalidRequest' }, true)).toEqual({ state: 'failed' });
    expect(await outcome(new TypeError('x'), true)).toEqual({ state: 'failed' });
  });

  it('reports that saving is unavailable without the desktop app', async () => {
    expect(await saveFile('pdf', BYTES, 'y', null)).toEqual({ state: 'unavailable' });
    expect(await saveFile('pdf', BYTES, 'y')).toEqual({ state: 'unavailable' });
  });
});
