import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { ModelCallError, type ModelClient } from './client.ts';
import { describeImport } from './format.ts';
import { MODELS } from './registry.ts';
import { activeModel, INITIAL_SETUP, setupReducer } from './setup-state.ts';
import type { DownloadError } from './types.ts';

function toDownloadError(error: unknown): DownloadError {
  return error instanceof ModelCallError ? error.error : { kind: 'io' };
}

export function useModelSetup(client: ModelClient | null) {
  const [state, dispatch] = useReducer(setupReducer, INITIAL_SETUP);

  const refresh = useCallback(async () => {
    if (client === null) return;
    try {
      const [statuses, hardware] = await Promise.all([
        Promise.all(MODELS.map((model) => client.status(model.id))),
        client.hardware().catch(() => null),
      ]);
      dispatch({ type: 'loaded', statuses, hardware });
    } catch (error) {
      dispatch({ type: 'error', error: toDownloadError(error) });
    }
  }, [client]);

  useEffect(() => {
    if (client === null) return undefined;
    let current = true;
    let unlisten: (() => void) | undefined;
    client
      .onDownload((event) => {
        dispatch({ type: 'event', event, at: performance.now() });
        if (event.state !== 'progress') void refresh();
      })
      .then(
        (stop) => {
          if (current) unlisten = stop;
          else stop();
        },
        () => undefined,
      );
    void refresh();
    return () => {
      current = false;
      unlisten?.();
    };
  }, [client, refresh]);

  const model = useMemo(() => activeModel(state), [state]);
  const status = state.statuses[model.id] ?? null;

  const guard = useCallback(async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      dispatch({ type: 'error', error: toDownloadError(error) });
    }
  }, []);

  const download = useCallback(async () => {
    if (client === null) return;
    dispatch({ type: 'error', error: null });
    dispatch({ type: 'note', note: null });
    await guard(async () => {
      await client.startDownload(model.id);
      await refresh();
    });
  }, [client, guard, model.id, refresh]);

  const cancel = useCallback(async () => {
    if (client === null) return;
    await guard(async () => {
      await client.cancelDownload(model.id);
    });
  }, [client, guard, model.id]);

  const remove = useCallback(async () => {
    if (client === null) return;
    dispatch({ type: 'note', note: null });
    await guard(async () => {
      dispatch({ type: 'status', status: await client.remove(model.id) });
    });
  }, [client, guard, model.id]);

  const importFiles = useCallback(async () => {
    if (client === null) return;
    dispatch({ type: 'error', error: null });
    dispatch({ type: 'importing', importing: true });
    await guard(async () => {
      const outcome = await client.importFiles(model.id);
      if (outcome !== null) {
        dispatch({
          type: 'note',
          note: describeImport(outcome.imported, outcome.unmatched, 2) || null,
        });
        await refresh();
      }
    });
    dispatch({ type: 'importing', importing: false });
  }, [client, guard, model.id, refresh]);

  return {
    available: client !== null,
    state,
    model,
    status,
    download,
    cancel,
    remove,
    importFiles,
    clearError: () => {
      dispatch({ type: 'error', error: null });
    },
  };
}

export type ModelSetup = ReturnType<typeof useModelSetup>;
