import { describe, expect, it } from 'vitest';
import { saveCsv, type Invoke } from './save-csv.ts';

function fakeInvoke(result: unknown, fail = false) {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const invoke: Invoke = (command, args) => {
    calls.push([command, args]);
    return fail
      ? Promise.reject(result)
      : Promise.resolve(JSON.parse(JSON.stringify(result ?? null)));
  };
  return { calls, invoke };
}

const outcome = (result: unknown, fail = false) =>
  saveCsv('x', 'y', fakeInvoke(result, fail).invoke);

describe('saveCsv', () => {
  it('passes only the text and a suggested name, never a path', async () => {
    const { calls, invoke } = fakeInvoke(null);
    await saveCsv('a;b', 'Wortzahlen', invoke);
    expect(calls).toEqual([['save_csv', { content: 'a;b', suggestedName: 'Wortzahlen' }]]);
  });

  it('reports a cancelled dialog', async () => {
    expect(await outcome(null)).toEqual({ state: 'cancelled' });
  });

  it('reports the name of the saved file', async () => {
    expect(await outcome({ fileName: 'Klasse.csv' })).toEqual({
      state: 'saved',
      fileName: 'Klasse.csv',
    });
  });

  it('reports a file that already exists', async () => {
    expect(await outcome({ kind: 'alreadyExists', fileName: 'klasse.csv' }, true)).toEqual({
      state: 'exists',
      fileName: 'klasse.csv',
    });
  });

  it('reports any other failure', async () => {
    expect(await outcome('kaputt', true)).toEqual({ state: 'failed' });
    expect(await outcome({ kind: 'tooLarge' }, true)).toEqual({ state: 'failed' });
  });
});
