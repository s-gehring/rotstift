import { useSyncExternalStore } from 'react';

let current: AbortController | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function beginExport(): AbortController | null {
  if (current !== null) return null;
  current = new AbortController();
  emit();
  return current;
}

export function endExport(job: AbortController) {
  if (current !== job) return;
  current = null;
  emit();
}

export function cancelExport() {
  const job = current;
  if (job === null) return;
  job.abort();
  endExport(job);
}

export function useExportBusy(): boolean {
  return useSyncExternalStore(subscribe, () => current !== null);
}
