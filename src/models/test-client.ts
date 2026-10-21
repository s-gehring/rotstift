import { vi } from 'vitest';
import type { ModelClient } from './client.ts';
import { ALL_MODELS, totalBytes } from './registry.ts';
import type { DownloadEvent, HardwareInfo, ModelState, ModelStatus } from './types.ts';

export interface FakeClientOptions {
  readonly states?: Readonly<Record<string, ModelState>>;
  readonly present?: Readonly<Record<string, number>>;
  readonly hardware?: HardwareInfo | null;
}

export function fakeModelClient(options: FakeClientOptions = {}) {
  const statuses = new Map<string, ModelStatus>(
    ALL_MODELS.map((model) => {
      const state = options.states?.[model.id] ?? 'missing';
      const total = totalBytes(model);
      return [
        model.id,
        {
          modelId: model.id,
          state,
          downloadedBytes: state === 'ready' ? total : (options.present?.[model.id] ?? 0),
          totalBytes: total,
        },
      ];
    }),
  );
  const handlers = new Set<(event: DownloadEvent) => void>();
  const control: { statusError: Error | null } = { statusError: null };

  const read = (modelId: string): ModelStatus => {
    const status = statuses.get(modelId);
    if (status === undefined) throw new Error(`unknown model ${modelId}`);
    return status;
  };
  const write = (modelId: string, state: ModelState, downloadedBytes?: number): ModelStatus => {
    const previous = read(modelId);
    const next = {
      ...previous,
      state,
      downloadedBytes: downloadedBytes ?? previous.downloadedBytes,
    };
    statuses.set(modelId, next);
    return next;
  };
  const dispatch = (event: DownloadEvent) => {
    if (event.state === 'cancelled' || event.state === 'failed') write(event.modelId, 'missing');
    if (event.state === 'done') write(event.modelId, 'ready', read(event.modelId).totalBytes);
    for (const handler of handlers) handler(event);
  };

  const status = vi.fn<ModelClient['status']>((modelId) =>
    control.statusError === null
      ? Promise.resolve(read(modelId))
      : Promise.reject(control.statusError),
  );
  const verify = vi.fn<ModelClient['verify']>((modelId) =>
    Promise.resolve(write(modelId, 'ready', read(modelId).totalBytes)),
  );
  const startDownload = vi.fn<ModelClient['startDownload']>((modelId) => {
    write(modelId, 'downloading');
    return Promise.resolve(undefined);
  });
  const cancelDownload = vi.fn<ModelClient['cancelDownload']>((modelId) => {
    dispatch({ modelId, state: 'cancelled' });
    return Promise.resolve(true);
  });
  const select = vi.fn<ModelClient['select']>(() => Promise.resolve(undefined));
  const remove = vi.fn<ModelClient['remove']>((modelId) =>
    Promise.resolve(write(modelId, 'missing', 0)),
  );
  const importFiles = vi.fn<ModelClient['importFiles']>(() => Promise.resolve(null));

  const client: ModelClient = {
    status,
    hardware: () =>
      options.hardware === undefined || options.hardware === null
        ? Promise.reject(new Error('no hardware'))
        : Promise.resolve(options.hardware),
    verify,
    startDownload,
    cancelDownload,
    selection: () => Promise.resolve(null),
    select,
    remove,
    importFiles,
    onDownload: (handler) => {
      handlers.add(handler);
      return Promise.resolve(() => {
        handlers.delete(handler);
      });
    },
  };

  return {
    client,
    control,
    status,
    verify,
    startDownload,
    cancelDownload,
    select,
    remove,
    importFiles,
    write,
    dispatch,
  };
}
