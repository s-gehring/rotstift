import { describe, expect, it } from 'vitest';
import type { ImportPage, Rotation } from '../import/pages.ts';
import { createRunner, isOutdated } from './runner.ts';
import type { PageTranscriber, TranscribeResult } from './transcriber.ts';

function page(id: string, rotation: Rotation = 0): ImportPage {
  return {
    id,
    fileKey: id,
    label: `${id}.png`,
    source: { kind: 'image', file: new File([], `${id}.png`) },
    width: 10,
    height: 10,
    rotation,
    thumbnailUrl: `blob:${id}`,
  };
}

interface Call {
  readonly png: Blob;
  readonly signal: AbortSignal;
  readonly resolve: (result: TranscribeResult) => void;
}

function setup() {
  const calls: Call[] = [];
  let active = 0;
  let maxActive = 0;
  const rendered: string[] = [];
  const transcriber: PageTranscriber = {
    transcribe: (png, signal) =>
      new Promise<TranscribeResult>((resolve) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const call: Call = {
          png,
          signal,
          resolve: (result) => {
            active -= 1;
            resolve(result);
          },
        };
        signal.addEventListener('abort', () =>
          call.resolve({ ok: false, error: { kind: 'cancelled' } }),
        );
        calls.push(call);
      }),
  };
  let clock = 0;
  const runner = createRunner({
    render: (p) => {
      rendered.push(`${p.id}:${p.rotation}`);
      return Promise.resolve(new Blob([p.id]));
    },
    now: () => clock,
  });
  runner.setTranscriber(transcriber);
  const waitForCalls = async (count: number) => {
    await vi_waitFor(() => expect(calls.length).toBe(count));
  };
  return {
    runner,
    calls,
    rendered,
    ok: (...lines: string[]): TranscribeResult => ({ ok: true, lines }),
    waitForCalls,
    maxActive: () => maxActive,
    advance: (ms: number) => {
      clock += ms;
    },
    status: (id: string) => runner.getState().entries[id]?.status,
  };
}

import { vi } from 'vitest';
const vi_waitFor = vi.waitFor;

describe('runner', () => {
  it('processes pages one at a time in page order', async () => {
    const t = setup();
    t.runner.setPages([page('a'), page('b'), page('c')]);
    t.runner.start();

    await t.waitForCalls(1);
    expect(t.status('a')).toBe('running');
    expect(t.status('b')).toBe('waiting');
    t.calls[0]?.resolve(t.ok('eins zwei'));

    await t.waitForCalls(2);
    t.calls[1]?.resolve(t.ok('drei'));
    await t.waitForCalls(3);
    t.calls[2]?.resolve(t.ok('vier'));

    await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
    expect(t.rendered).toEqual(['a:0', 'b:0', 'c:0']);
    expect(t.maxActive()).toBe(1);
    expect(t.runner.getState().entries['a']?.text).toBe('eins zwei');
    expect(t.status('c')).toBe('done');
  });

  it('hands the rendered PNG to the transcriber', async () => {
    const t = setup();
    t.runner.setPages([page('a')]);
    t.runner.start();
    await t.waitForCalls(1);
    expect(await t.calls[0]?.png.text()).toBe('a');
  });

  it('does nothing without a transcriber', () => {
    const t = setup();
    t.runner.setTranscriber(null);
    t.runner.setPages([page('a')]);
    t.runner.start();
    expect(t.runner.getState().entries).toEqual({});
  });

  it('cancels the running page and drops waiting pages but keeps finished ones', async () => {
    const t = setup();
    t.runner.setPages([page('a'), page('b'), page('c')]);
    t.runner.start();
    await t.waitForCalls(1);
    t.calls[0]?.resolve(t.ok('fertig'));
    await t.waitForCalls(2);

    t.runner.cancel();

    expect(t.calls[1]?.signal.aborted).toBe(true);
    await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
    expect(Object.keys(t.runner.getState().entries)).toEqual(['a']);
    expect(t.calls).toHaveLength(2);
  });

  it('restores the previous transcript when a re-recognition is cancelled', async () => {
    const t = setup();
    t.runner.setPages([page('a')]);
    t.runner.start();
    await t.waitForCalls(1);
    t.calls[0]?.resolve(t.ok('erkannt'));
    await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
    t.runner.edit('a', 'von Hand korrigiert');

    t.runner.retry('a');
    await t.waitForCalls(2);
    t.runner.cancel();

    expect(t.runner.getState().entries['a']).toMatchObject({
      status: 'done',
      text: 'von Hand korrigiert',
      edited: true,
    });
  });

  it('can start again after cancelling', async () => {
    const t = setup();
    t.runner.setPages([page('a'), page('b')]);
    t.runner.start();
    await t.waitForCalls(1);
    t.runner.cancel();
    t.runner.start();

    await t.waitForCalls(2);
    t.calls[1]?.resolve(t.ok('a neu'));
    await t.waitForCalls(3);
    t.calls[2]?.resolve(t.ok('b neu'));
    await vi.waitFor(() => expect(t.status('b')).toBe('done'));
    expect(t.runner.getState().entries['a']?.text).toBe('a neu');
  });

  it('records a failed page and continues with the next', async () => {
    const t = setup();
    t.runner.setPages([page('a'), page('b')]);
    t.runner.start();
    await t.waitForCalls(1);
    t.calls[0]?.resolve({ ok: false, error: { kind: 'failed', message: 'kaputt' } });
    await t.waitForCalls(2);
    t.calls[1]?.resolve(t.ok('gut'));

    await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
    expect(t.runner.getState().entries['a']).toMatchObject({
      status: 'error',
      error: { kind: 'failed', message: 'kaputt' },
    });
    expect(t.status('b')).toBe('done');
  });

  it('turns a throwing renderer into a failed page', async () => {
    const runner = createRunner({ render: () => Promise.reject(new Error('Render kaputt')) });
    runner.setTranscriber({ transcribe: () => Promise.reject(new Error('unreachable')) });
    runner.setPages([page('a')]);
    runner.start();
    await vi.waitFor(() => expect(runner.getState().entries['a']?.status).toBe('error'));
    expect(runner.getState().entries['a']?.error).toEqual({
      kind: 'failed',
      message: 'Render kaputt',
    });
  });

  it('retries a single failed page without touching the others', async () => {
    const t = setup();
    t.runner.setPages([page('a'), page('b')]);
    t.runner.start();
    await t.waitForCalls(1);
    t.calls[0]?.resolve({ ok: false, error: { kind: 'failed', message: 'x' } });
    await t.waitForCalls(2);
    t.calls[1]?.resolve(t.ok('b-text'));
    await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());

    t.runner.retry('a');
    await t.waitForCalls(3);
    expect(t.rendered.at(-1)).toBe('a:0');
    expect(t.runner.getState().batch).toEqual({ total: 1, finished: 0 });
    t.calls[2]?.resolve(t.ok('a-text'));

    await vi.waitFor(() => expect(t.status('a')).toBe('done'));
    expect(t.runner.getState().entries['b']?.text).toBe('b-text');
  });

  it('start re-queues failed pages but keeps finished ones', async () => {
    const t = setup();
    t.runner.setPages([page('a'), page('b')]);
    t.runner.start();
    await t.waitForCalls(1);
    t.calls[0]?.resolve({ ok: false, error: { kind: 'failed', message: 'x' } });
    await t.waitForCalls(2);
    t.calls[1]?.resolve(t.ok('b-text'));
    await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());

    t.runner.start();
    await t.waitForCalls(3);
    expect(t.rendered.slice(2)).toEqual(['a:0']);
  });

  it('ignores retry for queued pages', async () => {
    const t = setup();
    t.runner.setPages([page('a'), page('b')]);
    t.runner.start();
    await t.waitForCalls(1);
    t.runner.retry('a');
    t.runner.retry('b');
    expect(t.runner.getState().batch).toEqual({ total: 2, finished: 0 });
  });

  it('keeps edited text and marks the entry as edited', async () => {
    const t = setup();
    t.runner.setPages([page('a')]);
    t.runner.start();
    await t.waitForCalls(1);
    t.runner.edit('a', 'zu früh');
    expect(t.runner.getState().entries['a']?.text).toBe('');
    t.calls[0]?.resolve(t.ok('erkannt'));
    await vi.waitFor(() => expect(t.status('a')).toBe('done'));

    t.runner.edit('a', 'korrigiert');
    expect(t.runner.getState().entries['a']).toMatchObject({ text: 'korrigiert', edited: true });
  });

  describe('changes while running', () => {
    it('aborts and discards a running page that is removed, then continues', async () => {
      const t = setup();
      t.runner.setPages([page('a'), page('b')]);
      t.runner.start();
      await t.waitForCalls(1);

      t.runner.setPages([page('b')]);
      expect(t.calls[0]?.signal.aborted).toBe(true);
      expect(t.runner.getState().entries['a']).toBeUndefined();
      expect(t.runner.getState().batch).toEqual({ total: 1, finished: 0 });

      await t.waitForCalls(2);
      expect(t.rendered).toEqual(['a:0', 'b:0']);
      t.calls[1]?.resolve(t.ok('b-text'));
      await vi.waitFor(() => expect(t.status('b')).toBe('done'));
      expect(t.runner.getState().entries['a']).toBeUndefined();
    });

    it('drops a waiting page that is removed', async () => {
      const t = setup();
      t.runner.setPages([page('a'), page('b'), page('c')]);
      t.runner.start();
      await t.waitForCalls(1);
      t.runner.setPages([page('a'), page('c')]);
      t.calls[0]?.resolve(t.ok('a'));
      await t.waitForCalls(2);
      expect(t.rendered).toEqual(['a:0', 'c:0']);
      expect(t.runner.getState().batch).toEqual({ total: 2, finished: 1 });
    });

    it('follows the new page order for waiting pages', async () => {
      const t = setup();
      t.runner.setPages([page('a'), page('b'), page('c')]);
      t.runner.start();
      await t.waitForCalls(1);
      t.runner.setPages([page('a'), page('c'), page('b')]);
      t.calls[0]?.resolve(t.ok('a'));
      await t.waitForCalls(2);
      t.calls[1]?.resolve(t.ok('c'));
      await t.waitForCalls(3);
      expect(t.rendered).toEqual(['a:0', 'c:0', 'b:0']);
    });

    it('restarts the running page with the new rotation', async () => {
      const t = setup();
      t.runner.setPages([page('a'), page('b')]);
      t.runner.start();
      await t.waitForCalls(1);

      t.runner.setPages([page('a', 90), page('b')]);
      expect(t.calls[0]?.signal.aborted).toBe(true);
      expect(t.status('a')).toBe('waiting');

      await t.waitForCalls(2);
      expect(t.rendered).toEqual(['a:0', 'a:90']);
      t.calls[1]?.resolve(t.ok('gedreht'));
      await t.waitForCalls(3);
      t.calls[2]?.resolve(t.ok('b'));
      await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
      expect(t.runner.getState().entries['a']).toMatchObject({ text: 'gedreht', rotation: 90 });
      expect(t.maxActive()).toBe(1);
    });

    it('does not apply a stale result that arrives after the page was removed', async () => {
      const t = setup();
      t.runner.setPages([page('a')]);
      t.runner.start();
      await t.waitForCalls(1);
      t.runner.setPages([]);
      t.calls[0]?.resolve(t.ok('zu spät'));
      await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
      expect(t.runner.getState().entries).toEqual({});
    });

    it('flags finished pages rotated afterwards as outdated and re-queues them unless edited', async () => {
      const t = setup();
      t.runner.setPages([page('a'), page('b')]);
      t.runner.start();
      await t.waitForCalls(1);
      t.calls[0]?.resolve(t.ok('a'));
      await t.waitForCalls(2);
      t.calls[1]?.resolve(t.ok('b'));
      await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
      t.runner.edit('b', 'b editiert');

      const rotatedA = page('a', 180);
      t.runner.setPages([rotatedA, page('b', 90)]);
      const entryA = t.runner.getState().entries['a'];
      expect(entryA !== undefined && isOutdated(entryA, rotatedA)).toBe(true);

      t.runner.start();
      await t.waitForCalls(3);
      expect(t.rendered.slice(2)).toEqual(['a:180']);
      t.calls[2]?.resolve(t.ok('a neu'));
      await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
      expect(t.runner.getState().entries['b']?.text).toBe('b editiert');
    });

    it('leaves pages added after the start untouched until the next start', async () => {
      const t = setup();
      t.runner.setPages([page('a')]);
      t.runner.start();
      await t.waitForCalls(1);
      t.runner.setPages([page('a'), page('new')]);
      t.calls[0]?.resolve(t.ok('a'));
      await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
      expect(t.runner.getState().entries['new']).toBeUndefined();
      expect(t.calls).toHaveLength(1);
    });
  });

  it('tracks batch progress and the durations of successful pages only', async () => {
    const t = setup();
    t.runner.setPages([page('a'), page('b'), page('c')]);
    t.runner.start();
    expect(t.runner.getState().batch).toEqual({ total: 3, finished: 0 });

    await t.waitForCalls(1);
    t.advance(4000);
    t.calls[0]?.resolve(t.ok('a'));
    await t.waitForCalls(2);
    expect(t.runner.getState().batch).toEqual({ total: 3, finished: 1 });
    t.advance(2000);
    t.calls[1]?.resolve({ ok: false, error: { kind: 'failed', message: 'x' } });
    await t.waitForCalls(3);
    expect(t.runner.getState().durationsMs).toEqual([4000]);
    t.advance(6000);
    t.calls[2]?.resolve(t.ok('c'));

    await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
    expect(t.runner.getState().durationsMs).toEqual([4000, 6000]);
  });

  it('notifies subscribers and stops after unsubscribe', async () => {
    const t = setup();
    let notifications = 0;
    const unsubscribe = t.runner.subscribe(() => {
      notifications += 1;
    });
    t.runner.setPages([page('a')]);
    t.runner.start();
    expect(notifications).toBeGreaterThan(0);
    unsubscribe();
    const seen = notifications;
    t.runner.cancel();
    expect(notifications).toBe(seen);
  });
});
