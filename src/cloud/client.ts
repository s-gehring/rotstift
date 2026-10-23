import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { ModelRole } from '../app/types.ts';
import { isCloudError, type CloudErrorClass } from './errors.ts';

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type KeyStore = 'system' | 'session';

export interface CloudStep {
  readonly template: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly host: string;
  readonly model: string;
  readonly loopback: boolean;
  readonly confirmed: boolean;
  readonly protection: boolean;
  readonly key: KeyStore | null;
}

export interface CloudView {
  readonly steps: Readonly<Partial<Record<ModelRole, CloudStep>>>;
}

export interface RemoteModel {
  readonly id: string;
  readonly displayName: string;
}

export interface CloudInput {
  readonly template: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly key: string | null;
  readonly protection: boolean | null;
  readonly protectionConfirmed: boolean;
}

export class CloudCallError extends Error {
  readonly detail: CloudErrorClass;

  constructor(detail: CloudErrorClass) {
    super(`Cloud error: ${detail}`);
    this.name = 'CloudCallError';
    this.detail = detail;
  }
}

export function createCloudClient(invoke: Invoke = tauriInvoke) {
  async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      throw isCloudError(error) ? new CloudCallError(error.detail) : error;
    }
  }

  return {
    config: () => call<CloudView>('cloud_config'),
    use: (step: ModelRole, input: CloudInput, confirmed: boolean) =>
      call<CloudView>('cloud_use', { step, ...input, confirmed }),
    setProtection: (step: ModelRole, protection: boolean, confirmed: boolean) =>
      call<CloudView>('cloud_set_protection', { step, protection, confirmed }),
    setKey: (step: ModelRole, key: string) => call<CloudView>('cloud_set_key', { step, key }),
    clear: (step: ModelRole) => call<CloudView>('cloud_clear', { step }),
    models: (template: string, baseUrl: string, key: string | null) =>
      call<readonly RemoteModel[]>('cloud_models', { template, baseUrl, key }),
    check: (step: ModelRole) => call<undefined>('cloud_check', { step }),
  };
}

export type CloudClient = ReturnType<typeof createCloudClient>;
