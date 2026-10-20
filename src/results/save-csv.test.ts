import { describe, expect, it } from 'vitest';
import { fakeInvoke } from '../export/fake-invoke.ts';
import { saveCsv } from './save-csv.ts';

describe('saveCsv', () => {
  it('saves the text as UTF-8 bytes of kind csv, BOM included', async () => {
    const { calls, invoke } = fakeInvoke({ fileName: 'Wortzahlen.csv' });
    const outcome = await saveCsv('\uFEFFName;Wörter\r\n', 'Wortzahlen', invoke);
    expect(outcome).toEqual({ state: 'saved', fileName: 'Wortzahlen.csv' });
    expect(calls[0]?.command).toBe('save_file');
    expect(Array.from(calls[0]?.body ?? [])).toEqual(
      Array.from(new TextEncoder().encode('\uFEFFName;Wörter\r\n')),
    );
    expect(Array.from(calls[0]?.body.subarray(0, 3) ?? [])).toEqual([0xef, 0xbb, 0xbf]);
    expect(calls[0]?.headers).toEqual({
      'x-rotstift-kind': 'csv',
      'x-rotstift-name': 'Wortzahlen',
    });
  });
});
