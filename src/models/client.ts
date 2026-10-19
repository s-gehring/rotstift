import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import type {
  DownloadError,
  DownloadEvent,
  HardwareInfo,
  ImportOutcome,
  ModelStatus,
} from './types.ts';

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
export type Listen = (
  event: string,
  handler: (event: { payload: DownloadEvent }) => void,
) => Promise<() => void>;

export const DOWNLOAD_EVENT = 'model-download';

export class ModelCallError extends Error {
  readonly error: DownloadError;

  constructor(error: DownloadError) {
    super(`Model error: ${error.kind}`);
    this.name = 'ModelCallError';
    this.error = error;
  }
}

function isDownloadError(value: unknown): value is DownloadError {
  return typeof value === 'object' && value !== null && 'kind' in value;
}

export function createModelClient(
  invoke: Invoke = tauriInvoke,
  listen: Listen = tauriListen<DownloadEvent>,
) {
  async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      throw isDownloadError(error) ? new ModelCallError(error) : error;
    }
  }

  return {
    status: (modelId: string) => call<ModelStatus>('model_status', { modelId }),
    hardware: () => call<HardwareInfo>('hardware_info'),
    startDownload: (modelId: string) => call<undefined>('model_download_start', { modelId }),
    cancelDownload: (modelId: string) => call<boolean>('model_download_cancel', { modelId }),
    remove: (modelId: string) => call<ModelStatus>('model_delete', { modelId }),
    verify: (modelId: string) => call<ModelStatus>('model_verify', { modelId }),
    importFiles: (modelId: string) => call<ImportOutcome | null>('model_import', { modelId }),
    onDownload: (handler: (event: DownloadEvent) => void): Promise<() => void> =>
      listen(DOWNLOAD_EVENT, (event) => {
        handler(event.payload);
      }),
  };
}

export type ModelClient = ReturnType<typeof createModelClient>;
