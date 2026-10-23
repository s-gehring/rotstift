import { describe, expect, it, vi } from 'vitest';
import type { PageReading } from '../correction/uncertain-reading.ts';
import type { ImportPage } from '../import/pages.ts';
import type { EngineLease, LlmEngine } from '../llm/engine.ts';
import { recommendModel, secondReader } from '../models/registry.ts';
import { createLlmTranscriber, type EngineClient } from './llm-transcriber.ts';
import { createRunner } from './runner.ts';
import { withSecondReading } from './second-reading.ts';
import type { PageTranscriber, TranscribeResult } from './transcriber.ts';

function page(id: string): ImportPage {
  return {
    id,
    fileKey: id,
    label: `${id}.png`,
    source: { kind: 'image', file: new File([], `${id}.png`) },
    width: 10,
    height: 10,
    rotation: 0,
    thumbnailUrl: `blob:${id}`,
  };
}

const reading: PageReading = {
  uncertainBelow: 0.95,
  lines: [
    [
      { text: 'Der', confidence: 0.99 },
      { text: 'Hunt', confidence: 0.9 },
    ],
  ],
};

const first = (lines: string[] = ['Der Hunt']): TranscribeResult => ({ ok: true, lines, reading });
const second = (lines: string[] = ['Der Hund']): TranscribeResult => ({ ok: true, lines });

type Reply = (id: string, signal: AbortSignal) => Promise<TranscribeResult> | TranscribeResult;

function setup(readFirst: Reply, readSecond: Reply) {
  const log: string[] = [];
  const transcriber: PageTranscriber = {
    transcribe: async (png, signal) => {
      const id = await png.text();
      log.push(`first:${id}`);
      return readFirst(id, signal);
    },
    secondRead: async (png, signal) => {
      const id = await png.text();
      log.push(`second:${id}`);
      return readSecond(id, signal);
    },
  };
  const runner = createRunner({
    render: (p) => Promise.resolve(new Blob([p.id])),
  });
  runner.setTranscriber(transcriber);
  runner.setPages([page('a'), page('b'), page('c')]);
  const done = () => vi.waitFor(() => expect(runner.getState().batch).toBeNull());
  return { runner, log, done, entry: (id: string) => runner.getState().entries[id] };
}

const hangUntilAborted: Reply = (_id, signal) =>
  new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve({ ok: false, error: { kind: 'cancelled' } }));
  });

describe('runner second reading', () => {
  it('reads every page once before any page is read a second time', async () => {
    const t = setup(
      () => first(),
      () => second(),
    );
    t.runner.start();
    await t.done();
    expect(t.log).toEqual(['first:a', 'first:b', 'first:c', 'second:a', 'second:b', 'second:c']);
    for (const id of ['a', 'b', 'c']) {
      expect(t.entry(id)).toMatchObject({
        status: 'done',
        text: 'Der Hunt',
        awaitingSecond: false,
        reading: { lines: [[{ confidence: 1 }, { confidence: 0 }]] },
      });
    }
  });

  it('keeps the page counter on the first readings', async () => {
    const seen: (number | undefined)[] = [];
    const t = setup(
      () => first(),
      () => second(),
    );
    t.runner.subscribe(() => seen.push(t.runner.getState().batch?.finished));
    t.runner.start();
    await t.done();
    expect(seen.filter((finished) => finished !== undefined)).toSatisfy((values: number[]) =>
      values.every((value, index) => index === 0 || value >= (values[index - 1] ?? 0)),
    );
    expect(Math.max(...seen.map((finished) => finished ?? 0))).toBe(3);
  });

  it('keeps the first reading of a page whose second reading fails', async () => {
    const t = setup(
      () => first(),
      (id) => (id === 'b' ? { ok: false, error: { kind: 'failed', message: 'kaputt' } } : second()),
    );
    t.runner.start();
    await t.done();
    expect(t.log.filter((call) => call.startsWith('second'))).toHaveLength(3);
    expect(t.entry('b')).toMatchObject({
      status: 'done',
      text: 'Der Hunt',
      error: null,
      reading,
      awaitingSecond: false,
    });
    expect(t.entry('a')?.reading).not.toEqual(reading);
  });

  it('skips the second reading for pages without reading confidence or with an error', async () => {
    const t = setup(
      (id) =>
        id === 'a'
          ? { ok: true, lines: ['ohne'] }
          : id === 'b'
            ? { ok: false, error: { kind: 'failed', message: 'kaputt' } }
            : first(),
      () => second(),
    );
    t.runner.start();
    await t.done();
    expect(t.log.filter((call) => call.startsWith('second'))).toEqual(['second:c']);
    expect(t.entry('a')).toMatchObject({ status: 'done', text: 'ohne' });
    expect(t.entry('b')?.status).toBe('error');
  });

  it('stops in the middle of the second readings and keeps every first reading', async () => {
    const t = setup(
      () => first(),
      (id, signal) => (id === 'b' ? hangUntilAborted(id, signal) : second()),
    );
    t.runner.start();
    await vi.waitFor(() => expect(t.log).toContain('second:b'));
    t.runner.cancel();
    await t.done();
    expect(t.log).not.toContain('second:c');
    for (const id of ['a', 'b', 'c']) {
      expect(t.entry(id)).toMatchObject({ status: 'done', text: 'Der Hunt' });
      expect(t.entry(id)?.awaitingSecond).not.toBe(true);
    }
    expect(t.entry('b')?.reading).toEqual(reading);
    expect(t.entry('c')?.reading).toEqual(reading);
  });

  it('stops while the first readings are running without any second reading', async () => {
    const t = setup(
      (id, signal) => (id === 'b' ? hangUntilAborted(id, signal) : first()),
      () => second(),
    );
    t.runner.start();
    await vi.waitFor(() => expect(t.log).toContain('first:b'));
    t.runner.cancel();
    await t.done();
    expect(t.log.filter((call) => call.startsWith('second'))).toEqual([]);
    expect(t.entry('a')?.awaitingSecond).not.toBe(true);
  });

  it('reads only the retried page a second time', async () => {
    const t = setup(
      () => first(),
      () => second(),
    );
    t.runner.start();
    await t.done();
    t.log.length = 0;
    t.runner.retry('b');
    await vi.waitFor(() => expect(t.log).toEqual(['first:b', 'second:b']));
    await t.done();
  });

  it('does not touch the reading of a page the user edited meanwhile', async () => {
    const t = setup(
      () => first(),
      (id) => {
        if (id === 'a') t.runner.edit('a', 'Der Hundt');
        return second();
      },
    );
    t.runner.start();
    await t.done();
    expect(t.entry('a')).toMatchObject({ text: 'Der Hundt', edited: true, awaitingSecond: false });
  });
});

function engine() {
  const acquired: string[] = [];
  const fake: LlmEngine = {
    acquire: (model) => {
      acquired.push(model.id);
      const lease: EngineLease = { startupMs: 0, release: () => undefined };
      return Promise.resolve(lease);
    },
    monitor: () => ({ getPhase: () => 'ready', subscribe: () => () => undefined }),
    markFailed: () => undefined,
    reset: () => Promise.resolve(),
    loadedModel: () => null,
  };
  return { acquired, fake };
}

describe('model leases of a run with second reading', () => {
  const primary = recommendModel();
  const other = secondReader();

  const encoder = new TextEncoder();
  const logprobs = ['Der', ' Hunt'].map((text) => ({
    bytes: Array.from(encoder.encode(text)),
    logprob: Math.log(0.99),
  }));

  function llm(model: typeof primary, fake: LlmEngine) {
    const client: EngineClient = {
      status: () => Promise.resolve({ state: 'stopped' }),
      startModel: () => Promise.reject(new Error('unused')),
      complete: () => Promise.resolve({ text: 'Der Hunt', finishReason: 'stop', logprobs }),
    };
    return createLlmTranscriber({
      client,
      engine: fake,
      model,
      encode: () => Promise.resolve('data:image/jpeg;base64,AA=='),
    });
  }

  it('takes the first model for all pages before the second model for all pages', async () => {
    const { acquired, fake } = engine();
    const runner = createRunner({ render: (p) => Promise.resolve(new Blob([p.id])) });
    runner.setTranscriber(withSecondReading(llm(primary, fake), llm(other, fake)));
    runner.setPages([page('a'), page('b'), page('c')]);
    runner.start();
    await vi.waitFor(() => expect(runner.getState().batch).toBeNull());
    expect(acquired).toEqual([primary.id, primary.id, primary.id, other.id, other.id, other.id]);
    expect(Object.values(runner.getState().entries).map((entry) => entry.status)).toEqual([
      'done',
      'done',
      'done',
    ]);
  });
});
