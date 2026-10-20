import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type SaveOutcome =
  | { readonly state: 'saved'; readonly fileName: string }
  | { readonly state: 'cancelled' }
  | { readonly state: 'failed' };

interface SavedFile {
  readonly fileName: string;
}

export async function saveCsv(
  content: string,
  suggestedName: string,
  invoke: Invoke = tauriInvoke,
): Promise<SaveOutcome> {
  try {
    const saved = await invoke<SavedFile | null>('save_csv', { content, suggestedName });
    return saved === null ? { state: 'cancelled' } : { state: 'saved', fileName: saved.fileName };
  } catch {
    return { state: 'failed' };
  }
}
