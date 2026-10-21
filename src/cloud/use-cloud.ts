import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ModelRole } from '../app/types.ts';
import {
  CloudCallError,
  type CloudClient,
  type CloudInput,
  type CloudView,
  type RemoteModel,
} from './client.ts';
import type { CloudErrorClass } from './errors.ts';

export type CloudOutcome =
  | { readonly state: 'ok' }
  | { readonly state: 'consent' }
  | { readonly state: 'error'; readonly error: CloudErrorClass };

export type ModelsOutcome =
  | { readonly state: 'ok'; readonly models: readonly RemoteModel[] }
  | { readonly state: 'error'; readonly error: CloudErrorClass };

export interface CloudModel {
  readonly available: boolean;
  readonly steps: CloudView['steps'];
  readonly use: (role: ModelRole, input: CloudInput, confirmed: boolean) => Promise<CloudOutcome>;
  readonly models: (input: CloudInput) => Promise<ModelsOutcome>;
  readonly setKey: (role: ModelRole, key: string) => Promise<CloudErrorClass | null>;
  readonly clear: (role: ModelRole) => Promise<void>;
}

const EMPTY: CloudView = { steps: {} };

function errorClass(error: unknown): CloudErrorClass {
  return error instanceof CloudCallError ? error.detail : 'storage';
}

export function useCloud(client: CloudClient | null): CloudModel {
  const [view, setView] = useState<CloudView>(EMPTY);

  useEffect(() => {
    if (client === null) return undefined;
    let current = true;
    client.config().then(
      (loaded) => {
        if (current) setView(loaded);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [client]);

  const use = useCallback(
    async (role: ModelRole, input: CloudInput, confirmed: boolean): Promise<CloudOutcome> => {
      if (client === null) return { state: 'error', error: 'notConfigured' };
      try {
        await client.use(role, input, confirmed);
      } catch (error) {
        const detail = errorClass(error);
        if (detail === 'consentMissing' && !confirmed) return { state: 'consent' };
        return { state: 'error', error: detail };
      }
      try {
        await client.check(role);
        setView(await client.config());
        return { state: 'ok' };
      } catch (error) {
        setView(await client.clear(role).catch(() => EMPTY));
        return { state: 'error', error: errorClass(error) };
      }
    },
    [client],
  );

  const models = useCallback(
    async (input: CloudInput): Promise<ModelsOutcome> => {
      if (client === null) return { state: 'error', error: 'notConfigured' };
      try {
        return {
          state: 'ok',
          models: await client.models(input.template, input.baseUrl, input.key),
        };
      } catch (error) {
        return { state: 'error', error: errorClass(error) };
      }
    },
    [client],
  );

  const setKey = useCallback(
    async (role: ModelRole, key: string): Promise<CloudErrorClass | null> => {
      if (client === null) return 'notConfigured';
      try {
        setView(await client.setKey(role, key));
        return null;
      } catch (error) {
        return errorClass(error);
      }
    },
    [client],
  );

  const clear = useCallback(
    async (role: ModelRole) => {
      if (client === null) return;
      try {
        setView(await client.clear(role));
      } catch {
        setView(await client.config().catch(() => EMPTY));
      }
    },
    [client],
  );

  return useMemo(
    () => ({ available: client !== null, steps: view.steps, use, models, setKey, clear }),
    [client, view.steps, use, models, setKey, clear],
  );
}
