import type { Page } from '@playwright/test';

export interface TauriCall {
  readonly cmd: string;
  readonly args: Record<string, unknown>;
}

export interface TauriOptions {
  readonly totalRamGiB: number;
  readonly cloudCheckFails?: boolean;
}

declare global {
  interface Window {
    tauriCalls: TauriCall[];
  }
}

function install(options: TauriOptions): void {
  type Args = Record<string, unknown>;
  type Handler = (args: Args) => unknown;
  const GIB = 1024 ** 3;
  const calls: TauriCall[] = [];
  const callbacks = new Map<number, (payload: unknown) => void>();
  const listeners = new Map<string, number[]>();
  let nextId = 1;
  const selection: Record<string, string | null> = {
    transcriber: null,
    corrector: null,
    reviewer: null,
  };
  const custom: Args[] = [];
  const missing = new Set<string>();
  let cloudSteps: Record<string, Args> = {};

  const status = (modelId: string) => ({
    modelId,
    state: missing.has(modelId) ? 'missing' : 'ready',
    downloadedBytes: 0,
    totalBytes: 0,
  });
  const emit = (event: string, payload: unknown) => {
    for (const id of listeners.get(event) ?? []) callbacks.get(id)?.({ event, id, payload });
  };
  const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/u;
  const view = () => ({ steps: cloudSteps });

  const handlers: Record<string, Handler> = {
    'plugin:event|listen': ({ event, handler }) => {
      const id = Number(handler);
      listeners.set(String(event), [...(listeners.get(String(event)) ?? []), id]);
      return id;
    },
    'plugin:event|unlisten': () => null,
    hardware_info: () => ({ totalRamBytes: options.totalRamGiB * GIB, freeDiskBytes: 200 * GIB }),
    model_status: ({ modelId }) => status(String(modelId)),
    model_selection: () => selection.transcriber,
    model_corrector_selection: () => selection.corrector,
    model_reviewer_selection: () => selection.reviewer,
    model_select: ({ modelId }) => {
      selection.transcriber = String(modelId);
      return null;
    },
    model_select_corrector: ({ modelId }) => {
      selection.corrector = String(modelId);
      return null;
    },
    model_select_reviewer: ({ modelId }) => {
      selection.reviewer = String(modelId);
      return null;
    },
    model_custom_list: () => custom,
    model_custom_resolve: () => ({
      repo: 'beispiel/klein-GGUF',
      commit: '0123456789abcdef0123456789abcdef01234567',
      models: [
        { path: 'klein-Q4_K_M.gguf', bytes: 532_000_000, sha256: 'a'.repeat(64) },
        { path: 'klein-Q8_0.gguf', bytes: 812_000_000, sha256: 'b'.repeat(64) },
      ],
      projectors: [],
      model: 'klein-Q4_K_M.gguf',
      projector: null,
    }),
    model_custom_add_link: ({ role, repo, commit, model }) => {
      const id = 'custom-0123456789ab';
      custom.push({
        id,
        role,
        source: { kind: 'huggingFace', repo, revision: commit },
        files: {
          model: {
            name: model,
            url: `https://huggingface.co/${String(repo)}/resolve/${String(commit)}/${String(model)}`,
            sha256: 'a'.repeat(64),
            bytes: 532_000_000,
          },
          mmproj: null,
        },
      });
      missing.add(id);
      return id;
    },
    model_download_start: ({ modelId }) => {
      setTimeout(() => {
        emit('model-download', {
          modelId,
          state: 'progress',
          downloadedBytes: 266_000_000,
          totalBytes: 532_000_000,
        });
        missing.delete(String(modelId));
        emit('model-download', { modelId, state: 'done' });
      }, 50);
      return null;
    },
    model_download_cancel: () => true,
    model_verify: ({ modelId }) => status(String(modelId)),
    model_delete: ({ modelId }) => {
      const index = custom.findIndex((entry) => entry.id === modelId);
      if (index >= 0) custom.splice(index, 1);
      for (const step of Object.keys(selection)) {
        if (selection[step] === modelId) selection[step] = null;
      }
      missing.add(String(modelId));
      return status(String(modelId));
    },
    llm_probe_model: () => null,
    llm_status: () => ({ state: 'stopped' }),
    llm_stop: () => ({ state: 'stopped' }),
    diag_log: () => null,
    diag_heartbeat: () => null,
    diag_read: () => ['{"event":"app_start","version":"0.2.0"}'],
    diag_clear: () => null,
    cloud_config: () => view(),
    cloud_use: ({ step, template, baseUrl, model, key, confirmed }) => {
      const url = String(baseUrl);
      if (confirmed !== true && !LOOPBACK.test(url))
        return Promise.reject({ kind: 'cloud', detail: 'consentMissing' });
      cloudSteps = {
        ...cloudSteps,
        [String(step)]: {
          template,
          label: String(template),
          baseUrl: url,
          host: new URL(url).host,
          model,
          loopback: LOOPBACK.test(url),
          confirmed: confirmed === true,
          key: key === null ? null : 'session',
        },
      };
      return view();
    },
    cloud_check: () =>
      options.cloudCheckFails === true
        ? Promise.reject({ kind: 'cloud', detail: 'network' })
        : null,
    cloud_clear: ({ step }) => {
      const { [String(step)]: _removed, ...rest } = cloudSteps;
      cloudSteps = rest;
      return view();
    },
    cloud_set_key: () => view(),
    cloud_models: () => [
      { id: 'claude-test-1', displayName: 'Claude Test 1' },
      { id: 'claude-test-2', displayName: 'Claude Test 2' },
    ],
  };

  Object.assign(window, {
    tauriCalls: calls,
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
    __TAURI_INTERNALS__: {
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { windowLabel: 'main', label: 'main' },
      },
      transformCallback(callback: (payload: unknown) => void, once = false) {
        const id = nextId;
        nextId += 1;
        callbacks.set(id, (payload) => {
          if (once) callbacks.delete(id);
          callback(payload);
        });
        return id;
      },
      unregisterCallback(id: number) {
        callbacks.delete(id);
      },
      convertFileSrc: (path: string) => path,
      async invoke(cmd: string, args: Args = {}) {
        calls.push({ cmd, args });
        const handler = handlers[cmd];
        if (handler === undefined) throw new Error(`Not mocked: ${cmd}`);
        return handler(args);
      },
    },
  });
}

export async function mockTauri(page: Page, options: TauriOptions): Promise<void> {
  await page.addInitScript(install, options);
}

export function tauriCalls(page: Page, cmd: string): Promise<TauriCall[]> {
  return page.evaluate((name) => window.tauriCalls.filter((call) => call.cmd === name), cmd);
}
