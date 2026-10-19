export type ModelState =
  'missing' | 'downloading' | 'verifying' | 'unverified' | 'ready' | 'corrupt';

export interface ModelStatus {
  modelId: string;
  state: ModelState;
  downloadedBytes: number;
  totalBytes: number;
}

export interface HardwareInfo {
  totalRamBytes: number;
  freeDiskBytes: number | null;
}

export type DownloadError =
  | {
      kind: 'unknownModel' | 'notAllowed' | 'network' | 'io' | 'incomplete' | 'busy' | 'cancelled';
      detail?: string;
    }
  | { kind: 'insufficientDisk'; detail: { needed: number; available: number } }
  | { kind: 'http'; detail: { status: number } }
  | { kind: 'sizeMismatch' | 'hashMismatch'; detail: { file: string } };

export type DownloadEvent = { modelId: string } & (
  | { state: 'progress'; downloadedBytes: number; totalBytes: number }
  | { state: 'done' }
  | { state: 'cancelled' }
  | { state: 'failed'; error: DownloadError }
);

export type UnmatchedReason = 'unknownFile' | 'wrongContent' | 'ioError' | 'duplicate';

export interface UnmatchedFile {
  name: string;
  reason: UnmatchedReason;
}

export interface ImportOutcome {
  imported: string[];
  unmatched: UnmatchedFile[];
}
