import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { ModelCallError, type ModelClient } from './client.ts';
import { describeImport, probeProblem } from './format.ts';
import {
  CORRECTORS,
  DEFAULT_CORRECTOR_ID,
  DEFAULT_MODEL_ID,
  DEFAULT_REVIEWER_ID,
  MODELS,
  REVIEWERS,
  SECOND_READER_ID,
  SECOND_READERS,
  customEntry,
  modelFiles,
  type AnyModelInfo,
  type CorrectorInfo,
  type CustomModel,
  type FileRole,
  type ModelInfo,
} from './registry.ts';
import {
  ANY_MODEL,
  activeModel,
  baselineOf,
  errorOf,
  hasRunningJob,
  INITIAL_SETUP,
  samplesOf,
  setupReducer,
} from './setup-state.ts';
import type { DownloadError, ResolvedLink } from './types.ts';

function toDownloadError(error: unknown): DownloadError {
  return error instanceof ModelCallError ? error.error : { kind: 'io' };
}

interface Choice {
  readonly defaultId: string;
  readonly load: (client: ModelClient) => Promise<string | null>;
  readonly save: (client: ModelClient, modelId: string) => Promise<undefined>;
}

const TRANSCRIBER_CHOICE: Choice = {
  defaultId: DEFAULT_MODEL_ID,
  load: (client) => client.selection(),
  save: (client, modelId) => client.select(modelId),
};

const CORRECTOR_CHOICE: Choice = {
  defaultId: DEFAULT_CORRECTOR_ID,
  load: (client) => client.correctorSelection(),
  save: (client, modelId) => client.selectCorrector(modelId),
};

const REVIEWER_CHOICE: Choice = {
  defaultId: DEFAULT_REVIEWER_ID,
  load: (client) => client.reviewerSelection(),
  save: (client, modelId) => client.selectReviewer(modelId),
};

const SECOND_READER_CHOICE: Choice = {
  defaultId: SECOND_READER_ID,
  load: () => Promise.resolve(SECOND_READER_ID),
  save: () => Promise.resolve(undefined),
};

interface Change {
  readonly origin: symbol;
  readonly modelId: string;
  readonly custom?: boolean;
}

const changeListeners = new WeakMap<ModelClient, Set<(change: Change) => void>>();

function announceChange(client: ModelClient, change: Change) {
  for (const listener of changeListeners.get(client) ?? []) listener(change);
}

function withCustoms<T extends AnyModelInfo>(
  base: readonly T[],
  role: FileRole,
  customs: readonly CustomModel[],
): readonly T[] {
  const own = customs
    .filter((custom) => custom.role === role)
    .map((custom) => customEntry(custom))
    .filter((entry): entry is T => entry.role === role);
  return own.length === 0 ? base : [...base, ...own];
}

function useRoleSetup<T extends AnyModelInfo>(
  client: ModelClient | null,
  base: readonly T[],
  role: FileRole,
  choice: Choice,
  ownModels = true,
) {
  const [state, dispatch] = useReducer(setupReducer, INITIAL_SETUP);
  const origin = useRef(Symbol('model-setup'));
  const [customs, setCustoms] = useReducer(
    (_previous: readonly CustomModel[], next: readonly CustomModel[]) => next,
    [],
  );
  const models = useMemo(() => withCustoms(base, role, customs), [base, role, customs]);
  const awaitingProbe = useRef(new Set<string>());

  const verifying = useRef(new Set<string>());

  const verify = useCallback(
    async (modelId: string) => {
      if (client === null || verifying.current.has(modelId)) return;
      verifying.current.add(modelId);
      try {
        dispatch({ type: 'status', status: await client.verify(modelId) });
      } catch (error) {
        const failure = toDownloadError(error);
        if (failure.kind !== 'busy') {
          dispatch({ type: 'error', modelId, error: failure });
          try {
            dispatch({ type: 'status', status: await client.status(modelId) });
          } catch {
            dispatch({ type: 'mark', modelId, state: 'unverified' });
          }
        }
      } finally {
        verifying.current.delete(modelId);
      }
    },
    [client],
  );

  const refresh = useCallback(async () => {
    if (client === null) return;
    try {
      const loaded = ownModels ? await client.customModels().catch(() => []) : [];
      const listed = withCustoms(base, role, loaded);
      const [statuses, hardware, selectedId] = await Promise.all([
        Promise.all(listed.map((model) => client.status(model.id))),
        client.hardware().catch(() => null),
        choice.load(client).catch(() => null),
      ]);
      setCustoms(loaded);
      dispatch({
        type: 'loaded',
        statuses: statuses.map((status) =>
          status.state === 'unverified'
            ? { ...status, state: 'verifying', downloadedBytes: 0 }
            : status,
        ),
        hardware,
        selectedId,
      });
      for (const status of statuses) {
        if (status.state === 'unverified') void verify(status.modelId);
      }
    } catch (error) {
      dispatch({ type: 'error', modelId: ANY_MODEL, error: toDownloadError(error) });
    }
  }, [client, verify, choice, base, role, ownModels]);

  const probe = useCallback(
    async (modelId: string) => {
      if (client === null) return;
      awaitingProbe.current.delete(modelId);
      const failure = await client.probe(modelId);
      if (failure !== null && failure.kind !== 'notReady' && failure.kind !== 'cancelled') {
        dispatch({
          type: 'error',
          modelId,
          error: { kind: 'custom', detail: probeProblem(failure) },
        });
      }
    },
    [client],
  );

  useEffect(() => {
    if (client === null) return undefined;
    let current = true;
    let unlisten: (() => void) | undefined;
    client
      .onDownload((event) => {
        dispatch({ type: 'event', event, at: performance.now() });
        if (event.state !== 'progress' && event.state !== 'verifying') void refresh();
        if (event.state === 'done' && awaitingProbe.current.has(event.modelId)) {
          void probe(event.modelId);
        }
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
  }, [client, refresh, probe]);

  useEffect(() => {
    if (client === null) return undefined;
    const listeners = changeListeners.get(client) ?? new Set<(change: Change) => void>();
    changeListeners.set(client, listeners);
    const listener = (change: Change) => {
      if (
        change.origin !== origin.current &&
        (change.custom === true || models.some((model) => model.id === change.modelId))
      ) {
        void refresh();
      }
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [client, refresh, models]);

  const model = useMemo(() => activeModel(state, models), [state, models]);
  const status = state.statuses[model.id] ?? null;

  const guard = useCallback(async (modelId: string, action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      dispatch({ type: 'error', modelId, error: toDownloadError(error) });
    }
  }, []);

  const select = useCallback(
    async (modelId: string) => {
      if (client === null || modelId === model.id || hasRunningJob(state)) return;
      dispatch({ type: 'error', modelId: model.id, error: null });
      await guard(model.id, async () => {
        await choice.save(client, modelId);
        dispatch({ type: 'selected', modelId });
      });
    },
    [client, choice, guard, model.id, state],
  );

  const verifyAgain = useCallback(async () => {
    dispatch({ type: 'error', modelId: model.id, error: null });
    dispatch({ type: 'mark', modelId: model.id, state: 'verifying' });
    await verify(model.id);
  }, [model.id, verify]);

  const download = useCallback(async () => {
    if (client === null) return;
    dispatch({ type: 'error', modelId: model.id, error: null });
    dispatch({ type: 'note', note: null });
    dispatch({ type: 'started', modelId: model.id, presentBytes: status?.downloadedBytes ?? 0 });
    await guard(model.id, async () => {
      await client.startDownload(model.id);
      await refresh();
    });
  }, [client, guard, model.id, refresh, status?.downloadedBytes]);

  const cancel = useCallback(async () => {
    if (client === null) return;
    await guard(model.id, async () => {
      await client.cancelDownload(model.id);
    });
  }, [client, guard, model.id]);

  const remove = useCallback(
    async (modelId: string = model.id) => {
      if (client === null) return;
      dispatch({ type: 'note', note: null });
      await guard(modelId, async () => {
        dispatch({ type: 'status', status: await client.remove(modelId) });
        const custom = customs.some((entry) => entry.id === modelId);
        announceChange(client, { origin: origin.current, modelId, custom });
        if (custom) await refresh();
        const selectedId = await choice.load(client).catch(() => null);
        dispatch({ type: 'selected', modelId: selectedId ?? choice.defaultId });
      });
    },
    [client, guard, model.id, choice, customs, refresh],
  );

  const adopt = useCallback(
    async (modelId: string) => {
      if (client === null) return;
      announceChange(client, { origin: origin.current, modelId, custom: true });
      await refresh();
      await choice.save(client, modelId);
      dispatch({ type: 'selected', modelId });
      dispatch({ type: 'error', modelId, error: null });
      const current = await client.status(modelId);
      if (current.state === 'ready') {
        await probe(modelId);
        return;
      }
      awaitingProbe.current.add(modelId);
      dispatch({ type: 'started', modelId, presentBytes: current.downloadedBytes });
      await client.startDownload(modelId);
      await refresh();
    },
    [client, choice, probe, refresh],
  );

  const resolveLink = useCallback(
    async (link: string): Promise<ResolvedLink | null> => {
      if (client === null) return null;
      dispatch({ type: 'error', modelId: model.id, error: null });
      try {
        return await client.resolveLink(link);
      } catch (error) {
        dispatch({ type: 'error', modelId: model.id, error: toDownloadError(error) });
        return null;
      }
    },
    [client, model.id],
  );

  const addLink = useCallback(
    async (resolved: ResolvedLink, modelPath: string, projectorPath: string | null) => {
      if (client === null) return;
      await guard(model.id, async () => {
        const modelId = await client.addLink(
          role,
          resolved.repo,
          resolved.commit,
          modelPath,
          projectorPath,
        );
        await adopt(modelId);
      });
    },
    [client, guard, model.id, role, adopt],
  );

  const importCustom = useCallback(async () => {
    if (client === null) return;
    dispatch({ type: 'error', modelId: model.id, error: null });
    dispatch({ type: 'importing', importing: true });
    await guard(model.id, async () => {
      const modelId = await client.importCustom(role);
      if (modelId !== null) await adopt(modelId);
    });
    dispatch({ type: 'importing', importing: false });
  }, [client, guard, model.id, role, adopt]);

  const importFiles = useCallback(async () => {
    if (client === null) return;
    dispatch({ type: 'error', modelId: model.id, error: null });
    dispatch({ type: 'importing', importing: true });
    await guard(model.id, async () => {
      const outcome = await client.importFiles(model.id);
      if (outcome !== null) {
        dispatch({
          type: 'note',
          note:
            describeImport(outcome.imported, outcome.unmatched, modelFiles(model).length) || null,
        });
        await refresh();
        announceChange(client, { origin: origin.current, modelId: model.id });
      }
    });
    dispatch({ type: 'importing', importing: false });
  }, [client, guard, model, refresh]);

  return {
    available: client !== null,
    state,
    models,
    model,
    status,
    error: errorOf(state, model.id),
    loadError: state.loaded ? null : (state.errors[ANY_MODEL] ?? null),
    samples: samplesOf(state, model.id),
    baseline: baselineOf(state, model.id),
    select,
    download,
    cancel,
    remove,
    importFiles,
    resolveLink,
    addLink,
    importCustom,
    defaultId: choice.defaultId,
    selectRecommended: () => select(choice.defaultId),
    refresh,
    verifyAgain,
    clearError: () => {
      dispatch({ type: 'error', modelId: model.id, error: null });
    },
  };
}

export type ModelSetup<T extends AnyModelInfo = ModelInfo> = ReturnType<typeof useRoleSetup<T>>;

export function useModelSetup(client: ModelClient | null): ModelSetup {
  return useRoleSetup(client, MODELS, 'transcriber', TRANSCRIBER_CHOICE);
}

export function useCorrectorModelSetup(client: ModelClient | null): ModelSetup<CorrectorInfo> {
  return useRoleSetup(client, CORRECTORS, 'corrector', CORRECTOR_CHOICE);
}

export function useReviewerModelSetup(client: ModelClient | null): ModelSetup<CorrectorInfo> {
  return useRoleSetup(client, REVIEWERS, 'corrector', REVIEWER_CHOICE);
}

export function useSecondReaderSetup(client: ModelClient | null): ModelSetup {
  return useRoleSetup(client, SECOND_READERS, 'transcriber', SECOND_READER_CHOICE, false);
}
