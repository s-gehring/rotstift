import { invoke as tauriInvoke, isTauri } from '@tauri-apps/api/core';

export type FileKind = 'csv' | 'pdf';

export type Invoke = typeof tauriInvoke;

export type SaveOutcome =
  | { readonly state: 'saved'; readonly fileName: string }
  | { readonly state: 'cancelled' }
  | { readonly state: 'exists'; readonly fileName: string }
  | { readonly state: 'unavailable' }
  | { readonly state: 'failed'; readonly reason?: 'tooLarge' | 'build' };

interface SavedFile {
  readonly fileName: string;
}

function existingFileName(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { kind, fileName } = error as { kind?: unknown; fileName?: unknown };
  return kind === 'alreadyExists' && typeof fileName === 'string' ? fileName : null;
}

function isTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'kind' in error && error.kind === 'tooLarge'
  );
}

function defaultInvoke(): Invoke | null {
  return isTauri() ? tauriInvoke : null;
}

export async function saveFile(
  kind: FileKind,
  bytes: Uint8Array,
  suggestedName: string,
  invoke: Invoke | null = defaultInvoke(),
): Promise<SaveOutcome> {
  if (invoke === null) return { state: 'unavailable' };
  try {
    const saved = await invoke<SavedFile | null>('save_file', bytes, {
      headers: {
        'x-rotstift-kind': kind,
        'x-rotstift-name': encodeURIComponent(suggestedName),
      },
    });
    return saved === null ? { state: 'cancelled' } : { state: 'saved', fileName: saved.fileName };
  } catch (error) {
    const fileName = existingFileName(error);
    if (fileName !== null) return { state: 'exists', fileName };
    return isTooLarge(error) ? { state: 'failed', reason: 'tooLarge' } : { state: 'failed' };
  }
}
