import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type SaveOutcome =
  | { readonly state: 'saved'; readonly fileName: string }
  | { readonly state: 'cancelled' }
  | { readonly state: 'exists'; readonly fileName: string }
  | { readonly state: 'failed' };

interface SavedFile {
  readonly fileName: string;
}

function existingFileName(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { kind, fileName } = error as { kind?: unknown; fileName?: unknown };
  return kind === 'alreadyExists' && typeof fileName === 'string' ? fileName : null;
}

export async function saveCsv(
  content: string,
  suggestedName: string,
  invoke: Invoke = tauriInvoke,
): Promise<SaveOutcome> {
  try {
    const saved = await invoke<SavedFile | null>('save_csv', { content, suggestedName });
    return saved === null ? { state: 'cancelled' } : { state: 'saved', fileName: saved.fileName };
  } catch (error) {
    const fileName = existingFileName(error);
    return fileName === null ? { state: 'failed' } : { state: 'exists', fileName };
  }
}
