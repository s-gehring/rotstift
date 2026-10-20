import { describe, expect, it, vi } from 'vitest';
import type { ImportPage, Rotation } from '../import/pages.ts';
import { createRunner, isCounting, isOutdated, isSwitchLocked, startablePages } from './runner.ts';
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

function setup({ ignoreAbort = false } = {}) {
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
        if (!ignoreAbort) {
          signal.addEventListener('abort', () =>
            call.resolve({ ok: false, error: { kind: 'cancelled' } }),
          );
        }
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
    await vi.waitFor(() => expect(calls.length).toBe(count));
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

  it('keeps the old transcript visible while a page is recognised again', async () => {
    const t = setup();
    t.runner.setPages([page('a')]);
    t.runner.start();
    await t.waitForCalls(1);
    t.calls[0]?.resolve(t.ok('erkannt'));
    await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());

    t.runner.retry('a');
    await t.waitForCalls(2);
    expect(t.runner.getState().entries['a']).toMatchObject({ status: 'running', text: 'erkannt' });
    t.runner.edit('a', 'während des Laufs');
    expect(t.runner.getState().entries['a']?.text).toBe('erkannt');
  });

  it('falls back to the edited transcript when recognising it again fails', async () => {
    const t = setup();
    t.runner.setPages([page('a')]);
    t.runner.start();
    await t.waitForCalls(1);
    t.calls[0]?.resolve(t.ok('erkannt'));
    await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
    t.runner.edit('a', 'von Hand korrigiert');

    t.runner.retry('a');
    await t.waitForCalls(2);
    t.calls[1]?.resolve({ ok: false, error: { kind: 'failed', message: 'kaputt' } });
    await vi.waitFor(() => expect(t.status('a')).toBe('done'));

    expect(t.runner.getState().entries['a']).toMatchObject({
      text: 'von Hand korrigiert',
      edited: true,
      error: { kind: 'failed', message: 'kaputt' },
    });
    t.runner.edit('a', 'weiter bearbeitet');
    expect(t.runner.getState().entries['a']?.text).toBe('weiter bearbeitet');
  });

  it('clears the failure hint once a later attempt succeeds', async () => {
    const t = setup();
    t.runner.setPages([page('a')]);
    t.runner.start();
    await t.waitForCalls(1);
    t.calls[0]?.resolve(t.ok('erkannt'));
    await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
    t.runner.retry('a');
    await t.waitForCalls(2);
    t.calls[1]?.resolve({ ok: false, error: { kind: 'failed', message: 'x' } });
    await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
    t.runner.retry('a');
    await t.waitForCalls(3);
    t.calls[2]?.resolve(t.ok('neu'));
    await vi.waitFor(() => expect(t.status('a')).toBe('done'));
    expect(t.runner.getState().entries['a']).toMatchObject({ text: 'neu', error: null });
  });

  describe('a transcriber that ignores the abort signal', () => {
    it('does not hang the run after cancelling', async () => {
      const t = setup({ ignoreAbort: true });
      t.runner.setPages([page('a'), page('b')]);
      t.runner.start();
      await t.waitForCalls(1);

      t.runner.cancel();
      t.runner.start();

      await t.waitForCalls(2);
      expect(t.rendered).toEqual(['a:0', 'a:0']);
      expect(t.runner.getState().batch).toEqual({ total: 2, finished: 0 });
    });

    it('discards the late result of the cancelled attempt', async () => {
      const t = setup({ ignoreAbort: true });
      t.runner.setPages([page('a')]);
      t.runner.start();
      await t.waitForCalls(1);
      t.runner.cancel();
      t.runner.start();
      await t.waitForCalls(2);

      t.calls[0]?.resolve(t.ok('veraltet'));
      expect(t.runner.getState().entries['a']?.status).toBe('running');
      t.calls[1]?.resolve(t.ok('aktuell'));
      await vi.waitFor(() => expect(t.status('a')).toBe('done'));
      expect(t.runner.getState().entries['a']?.text).toBe('aktuell');
    });

    it('moves on when a page is removed while it is running', async () => {
      const t = setup({ ignoreAbort: true });
      t.runner.setPages([page('a'), page('b')]);
      t.runner.start();
      await t.waitForCalls(1);
      t.runner.setPages([page('b')]);
      await t.waitForCalls(2);
      expect(t.rendered).toEqual(['a:0', 'b:0']);
    });
  });

  it('swallows a late rejection of an abandoned attempt', async () => {
    const runner = createRunner({ render: () => Promise.resolve(new Blob()) });
    const pending: { reject: (reason: Error) => void } = { reject: () => undefined };
    runner.setTranscriber({
      transcribe: () =>
        new Promise<TranscribeResult>((_resolve, reject) => {
          pending.reject = reject;
        }),
    });
    runner.setPages([page('a')]);
    runner.start();
    await vi.waitFor(() => expect(runner.getState().entries['a']?.status).toBe('running'));
    runner.cancel();
    pending.reject(new Error('zu spät'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runner.getState().entries).toEqual({});
  });

  it('reports which pages a new start would pick up', async () => {
    const t = setup();
    const a = page('a');
    const b = page('b');
    t.runner.setPages([a, b]);
    expect(startablePages([a, b], t.runner.getState()).queue).toEqual([a, b]);
    t.runner.start();
    await t.waitForCalls(1);
    t.calls[0]?.resolve(t.ok('a'));
    await t.waitForCalls(2);
    t.calls[1]?.resolve(t.ok('b'));
    await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
    t.runner.edit('b', 'bearbeitet');

    const rotatedB = page('b', 90);
    const startable = startablePages([a, rotatedB], t.runner.getState());
    expect(startable.queue).toEqual([]);
    expect(startable.skippedEdited).toEqual([rotatedB]);
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

  it('leaves the sidecar startup out of the page duration', async () => {
    const t = setup();
    t.runner.setPages([page('a'), page('b')]);
    t.runner.start();
    await t.waitForCalls(1);
    t.advance(25_000);
    t.calls[0]?.resolve({ ok: true, lines: ['a'], startupMs: 20_000 });
    await t.waitForCalls(2);
    t.advance(5000);
    t.calls[1]?.resolve(t.ok('b'));
    await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
    expect(t.runner.getState().durationsMs).toEqual([5000, 5000]);
  });

  describe('sidecar crashes', () => {
    const crash: TranscribeResult = {
      ok: false,
      error: { kind: 'failed', message: 'beendet', crashed: true },
    };

    it('keeps going after the first crash and ends the batch after the second', async () => {
      const t = setup();
      t.runner.setPages([page('a'), page('b'), page('c'), page('d')]);
      t.runner.start();
      await t.waitForCalls(1);
      t.calls[0]?.resolve(crash);
      await t.waitForCalls(2);
      expect(t.status('b')).toBe('running');
      t.calls[1]?.resolve(crash);

      await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
      expect(t.calls).toHaveLength(2);
      const entries = t.runner.getState().entries;
      expect(entries['a']?.status).toBe('error');
      expect(entries['b']?.status).toBe('error');
      for (const id of ['c', 'd']) {
        expect(entries[id]).toMatchObject({
          status: 'error',
          error: { kind: 'failed', message: expect.stringContaining('Arbeitsspeicher') },
        });
      }
    });

    it('allows one restart in every new batch', async () => {
      const t = setup();
      t.runner.setPages([page('a'), page('b'), page('c')]);
      t.runner.start();
      await t.waitForCalls(1);
      t.calls[0]?.resolve(crash);
      await t.waitForCalls(2);
      t.calls[1]?.resolve(t.ok('b'));
      await t.waitForCalls(3);
      t.calls[2]?.resolve(t.ok('c'));
      await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
      expect(t.status('c')).toBe('done');

      t.runner.retry('a');
      await t.waitForCalls(4);
      t.calls[3]?.resolve(t.ok('a'));
      await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
      expect(t.status('a')).toBe('done');
    });

    it('does not end the batch for ordinary failures', async () => {
      const t = setup();
      t.runner.setPages([page('a'), page('b'), page('c')]);
      t.runner.start();
      for (let index = 0; index < 3; index += 1) {
        await t.waitForCalls(index + 1);
        t.calls[index]?.resolve({ ok: false, error: { kind: 'failed', message: 'x' } });
      }
      await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());
      expect(t.calls).toHaveLength(3);
    });
  });

  it('keeps counted pages when the transcriber is swapped and uses the new one for the rest', async () => {
    const t = setup();
    t.runner.setPages([page('a'), page('b')]);
    t.runner.start();
    await t.waitForCalls(1);
    t.calls[0]?.resolve(t.ok('eins', 'zwei'));
    await t.waitForCalls(2);
    t.calls[1]?.resolve({ ok: false, error: { kind: 'cancelled' } });
    await vi.waitFor(() => expect(t.runner.getState().batch).toBeNull());

    const second = vi.fn<PageTranscriber['transcribe']>(() =>
      Promise.resolve({ ok: true, lines: ['drei'] }),
    );
    t.runner.setTranscriber({ transcribe: second });
    expect(t.runner.getState().entries['a']).toMatchObject({ status: 'done', text: 'eins\nzwei' });

    t.runner.start();
    await vi.waitFor(() => expect(t.status('b')).toBe('done'));
    expect(second).toHaveBeenCalledOnce();
    expect(t.runner.getState().entries['a']?.text).toBe('eins\nzwei');
    expect(t.runner.getState().entries['b']?.text).toBe('drei');
  });

  it('locks the model switch while counting, retrying a single page or starting the engine', async () => {
    const t = setup();
    expect(isSwitchLocked(t.runner.getState(), 'idle')).toBe(false);
    expect(isSwitchLocked(t.runner.getState(), 'starting')).toBe(true);
    expect(isSwitchLocked(t.runner.getState(), 'ready')).toBe(false);

    t.runner.setPages([page('a')]);
    t.runner.start();
    await t.waitForCalls(1);
    expect(isCounting(t.runner.getState())).toBe(true);
    expect(isSwitchLocked(t.runner.getState(), 'ready')).toBe(true);
    t.calls[0]?.resolve(t.ok('eins'));
    await vi.waitFor(() => expect(isCounting(t.runner.getState())).toBe(false));

    t.runner.retry('a');
    await t.waitForCalls(2);
    expect(isSwitchLocked(t.runner.getState(), 'ready')).toBe(true);
    t.calls[1]?.resolve(t.ok('zwei'));
    await vi.waitFor(() => expect(isSwitchLocked(t.runner.getState(), 'ready')).toBe(false));
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
