import type { Page } from '@playwright/test';

export interface TauriCall {
  readonly cmd: string;
  readonly args: Record<string, unknown>;
}

export interface CloudChatCheck {
  readonly forbidden: readonly string[];
  readonly fix: readonly [string, string];
}

export interface TauriOptions {
  readonly totalRamGiB: number;
  readonly cloudCheckFails?: boolean;
  readonly cloudCheckError?: string;
  readonly cliFound?: boolean;
  readonly transcript?: readonly string[];
  readonly cloudChat?: CloudChatCheck;
  readonly privacyAnswer?: string;
  readonly missing?: readonly string[];
}

declare global {
  interface Window {
    tauriCalls: TauriCall[];
    cloudViolations: string[];
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
  const missing = new Set<string>(options.missing ?? []);
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
  const violations: string[] = [];
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
    llm_start_model: ({ modelId }) => ({ state: 'ready', model: String(modelId), port: 1 }),
    llm_stop_if_idle: () => false,
    llm_cancel: () => null,
    privacy_unknown_words: () => [],
    llm_chat: ({ request }) =>
      JSON.stringify(request).includes('"name":"personenbezug"')
        ? {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: options.privacyAnswer ?? '{"kennungen":[],"sensibel":[]}',
                },
                finish_reason: 'stop',
              },
            ],
          }
        : options.transcript === undefined
          ? Promise.reject({ kind: 'request', detail: 'not mocked' })
          : {
              choices: [
                {
                  message: { role: 'assistant', content: options.transcript.join('\n') },
                  finish_reason: 'stop',
                },
              ],
            },
    cloud_cancel: () => null,
    cloud_chat: ({ step, pseudonymized, request }) => {
      const check = options.cloudChat;
      if (check === undefined) return Promise.reject({ kind: 'cloud', detail: 'network' });
      const sent = JSON.stringify(request);
      if (pseudonymized !== true) violations.push(`${String(step)} ohne pseudonymized`);
      for (const name of check.forbidden) {
        if (sent.includes(name)) violations.push(`${String(step)} enthält ${name}`);
      }
      if (violations.length > 0) {
        return Promise.reject({ kind: 'cloud', detail: 'notPseudonymized' });
      }
      const contents = Array.from(sent.matchAll(/"content":"((?:[^"\\]|\\.)*)"/gu), (match) =>
        String(JSON.parse(`"${match[1] ?? ''}"`)),
      );
      const numbered = (contents.at(-1) ?? '').split('\n').filter((line) => /^\d+: /u.test(line));
      const content = numbered.join('\n').replaceAll(check.fix[0], check.fix[1]);
      return { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] };
    },
    diag_log: () => null,
    diag_heartbeat: () => null,
    diag_read: () => ['{"event":"app_start","version":"0.2.0"}'],
    diag_clear: () => null,
    cloud_config: () => view(),
    cli_find: () =>
      options.cliFound === false ? null : { path: '/opt/fake/bin/claude', version: '2.1.299' },
    cli_pick: () => ({ path: '/opt/picked/claude', version: '2.1.300' }),
    cloud_use: ({
      step,
      template,
      baseUrl,
      model,
      key,
      cliPath,
      confirmed,
      protection,
      protectionConfirmed,
    }) => {
      const url = String(baseUrl);
      const loopback = LOOPBACK.test(url);
      const defaultProtection = template !== 'server' && !loopback;
      const protect = typeof protection === 'boolean' ? protection : defaultProtection;
      if (protect && step === 'transcriber')
        return Promise.reject({ kind: 'cloud', detail: 'protectionActive' });
      if (confirmed !== true && !loopback)
        return Promise.reject({ kind: 'cloud', detail: 'consentMissing' });
      if (!protect && defaultProtection && protectionConfirmed !== true)
        return Promise.reject({ kind: 'cloud', detail: 'protectionConsentMissing' });
      const viaCli = url.startsWith('cli://');
      if (viaCli && typeof cliPath !== 'string')
        return Promise.reject({ kind: 'cloud', detail: 'cliMissing' });
      cloudSteps = {
        ...cloudSteps,
        [String(step)]: {
          template,
          label: viaCli ? 'Claude-Abo' : String(template),
          baseUrl: url,
          host: new URL(url).host,
          model,
          loopback,
          confirmed: confirmed === true || loopback,
          protection: protect,
          key: key === null ? null : 'session',
          cli: viaCli ? { path: cliPath, version: '2.1.299' } : null,
        },
      };
      return view();
    },
    cloud_set_protection: ({ step, protection, confirmed }) => {
      const current = cloudSteps[String(step)];
      if (current === undefined) return Promise.reject({ kind: 'cloud', detail: 'notConfigured' });
      const defaultProtection = current['template'] !== 'server' && current['loopback'] !== true;
      if (protection !== true && defaultProtection && confirmed !== true)
        return Promise.reject({ kind: 'cloud', detail: 'protectionConsentMissing' });
      cloudSteps = {
        ...cloudSteps,
        [String(step)]: { ...current, protection: protection === true },
      };
      return view();
    },
    cloud_check: () =>
      options.cloudCheckError !== undefined
        ? Promise.reject({ kind: 'cloud', detail: options.cloudCheckError })
        : options.cloudCheckFails === true
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
    cloudViolations: violations,
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

export function cloudViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => window.cloudViolations);
}

export function tauriCalls(page: Page, cmd: string): Promise<TauriCall[]> {
  return page.evaluate((name) => window.tauriCalls.filter((call) => call.cmd === name), cmd);
}
