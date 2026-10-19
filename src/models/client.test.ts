import { describe, expect, it } from 'vitest';
import { ModelCallError, createModelClient, type Invoke, type Listen } from './client.ts';
import type { DownloadEvent } from './types.ts';

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

describe('createModelClient', () => {
  it('passes only model ids to Rust', async () => {
    const { calls, invoke } = fakeInvoke(undefined);
    const client = createModelClient(invoke, () => Promise.resolve(() => undefined));
    await client.startDownload('m');
    await client.cancelDownload('m');
    await client.remove('m');
    await client.importFiles('m');
    await client.status('m');
    expect(calls).toEqual([
      ['model_download_start', { modelId: 'm' }],
      ['model_download_cancel', { modelId: 'm' }],
      ['model_delete', { modelId: 'm' }],
      ['model_import', { modelId: 'm' }],
      ['model_status', { modelId: 'm' }],
    ]);
  });

  it('wraps Rust errors', async () => {
    const { invoke } = fakeInvoke(
      { kind: 'insufficientDisk', detail: { needed: 2, available: 1 } },
      true,
    );
    const client = createModelClient(invoke, () => Promise.resolve(() => undefined));
    const result = client.startDownload('m');
    await expect(result).rejects.toBeInstanceOf(ModelCallError);
    await expect(result).rejects.toMatchObject({ error: { kind: 'insufficientDisk' } });
  });

  it('forwards download events and can unsubscribe', async () => {
    const received: DownloadEvent[] = [];
    const handlers: ((event: { payload: DownloadEvent }) => void)[] = [];
    let unlistened = false;
    const listen: Listen = (name, handler) => {
      expect(name).toBe('model-download');
      handlers.push(handler);
      return Promise.resolve(() => {
        unlistened = true;
      });
    };
    const client = createModelClient(fakeInvoke(undefined).invoke, listen);
    const stop = await client.onDownload((event) => received.push(event));
    handlers[0]?.({ payload: { modelId: 'm', state: 'done' } });
    expect(received).toEqual([{ modelId: 'm', state: 'done' }]);
    stop();
    expect(unlistened).toBe(true);
  });
});
