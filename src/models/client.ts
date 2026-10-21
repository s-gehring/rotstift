import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import { isLlmError } from '../llm/client.ts';
import type { LlmError } from '../llm/types.ts';
import { customModelSchema, type CustomModel, type FileRole } from './registry.ts';
import type {
  DownloadError,
  DownloadEvent,
  HardwareInfo,
  ImportOutcome,
  ModelStatus,
  ResolvedLink,
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
    selection: () => call<string | null>('model_selection'),
    select: (modelId: string) => call<undefined>('model_select', { modelId }),
    correctorSelection: () => call<string | null>('model_corrector_selection'),
    selectCorrector: (modelId: string) => call<undefined>('model_select_corrector', { modelId }),
    reviewerSelection: () => call<string | null>('model_reviewer_selection'),
    selectReviewer: (modelId: string) => call<undefined>('model_select_reviewer', { modelId }),
    remove: (modelId: string) => call<ModelStatus>('model_delete', { modelId }),
    verify: (modelId: string) => call<ModelStatus>('model_verify', { modelId }),
    importFiles: (modelId: string) => call<ImportOutcome | null>('model_import', { modelId }),
    customModels: async (): Promise<CustomModel[]> =>
      (await call<unknown[]>('model_custom_list')).flatMap((entry) => {
        const parsed = customModelSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      }),
    resolveLink: (link: string) => call<ResolvedLink>('model_custom_resolve', { link }),
    addLink: (
      role: FileRole,
      repo: string,
      commit: string,
      model: string,
      projector: string | null,
    ) => call<string>('model_custom_add_link', { role, repo, commit, model, projector }),
    importCustom: (role: FileRole) => call<string | null>('model_custom_import', { role }),
    probe: async (modelId: string): Promise<LlmError | null> => {
      try {
        await invoke<undefined>('llm_probe_model', { modelId });
        return null;
      } catch (error) {
        return isLlmError(error) ? error : { kind: 'request', detail: String(error) };
      }
    },
    onDownload: (handler: (event: DownloadEvent) => void): Promise<() => void> =>
      listen(DOWNLOAD_EVENT, (event) => {
        handler(event.payload);
      }),
  };
}

export type ModelClient = ReturnType<typeof createModelClient>;
