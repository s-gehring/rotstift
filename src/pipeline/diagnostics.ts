import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export type DiagFields = Readonly<Record<string, number | boolean | string>>;

export interface PipelineDiagnostics {
  readonly log: (event: string, fields?: DiagFields) => void;
  readonly heartbeat: (batchActive: boolean) => void;
}

export type DiagInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export const HEARTBEAT_INTERVAL_MS = 5000;

export const noDiagnostics: PipelineDiagnostics = {
  log: () => undefined,
  heartbeat: () => undefined,
};

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

export function tauriDiagnostics(invoke: DiagInvoke = tauriInvoke): PipelineDiagnostics {
  const send = (command: string, args: Record<string, unknown>) => {
    try {
      invoke(command, args).catch(() => undefined);
    } catch {
      return;
    }
  };
  return {
    log: (event, fields = {}) => {
      send('diag_log', { event, fields });
    },
    heartbeat: (batchActive) => {
      send('diag_heartbeat', { batchActive, visible: isVisible() });
    },
  };
}

let browser: PipelineDiagnostics | undefined;

export function browserDiagnostics(): PipelineDiagnostics {
  browser ??=
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
      ? tauriDiagnostics()
      : noDiagnostics;
  return browser;
}

export function createHeartbeat(
  diagnostics: PipelineDiagnostics,
  intervalMs = HEARTBEAT_INTERVAL_MS,
) {
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    start() {
      if (timer !== undefined) return;
      diagnostics.heartbeat(true);
      timer = setInterval(() => {
        diagnostics.heartbeat(true);
      }, intervalMs);
    },
    stop() {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
      diagnostics.heartbeat(false);
    },
  };
}

export interface LayoutOutcome {
  readonly foundLines: number;
  readonly transcriptLines: number;
  readonly assignedLines: number;
  readonly roughLines: number;
  readonly durationMs: number;
}

export function logLayout(diagnostics: PipelineDiagnostics, outcome: LayoutOutcome | null): void {
  if (outcome === null) diagnostics.log('page_layout', { failed: true });
  else diagnostics.log('page_layout', { ...outcome, durationMs: Math.round(outcome.durationMs) });
}

export type DiagnosticsEntry = Readonly<Record<string, unknown>>;

export async function readDiagnostics(
  invoke: DiagInvoke = tauriInvoke,
  limit = 200,
): Promise<string[]> {
  const lines = await invoke('diag_read', { limit });
  return Array.isArray(lines)
    ? lines.filter((line): line is string => typeof line === 'string')
    : [];
}

export async function clearDiagnostics(invoke: DiagInvoke = tauriInvoke): Promise<void> {
  await invoke('diag_clear');
}
