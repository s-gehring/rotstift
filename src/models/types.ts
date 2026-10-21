export type ModelState =
  | 'missing'
  | 'downloading'
  | 'verifying'
  | 'importing'
  | 'deleting'
  | 'unverified'
  | 'ready'
  | 'corrupt';

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
  | { kind: 'sizeMismatch' | 'hashMismatch'; detail: { file: string } }
  | { kind: 'custom'; detail: CustomProblem };

export type CustomProblem =
  | {
      reason:
        'noLink' | 'gated' | 'notFound' | 'noGguf' | 'splitFile' | 'noProjector' | 'tooManyFiles';
    }
  | { reason: 'notGguf' | 'projector'; file: string }
  | { reason: 'unsupported'; what: string | null };

export interface RemoteFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ResolvedLink {
  repo: string;
  commit: string;
  models: RemoteFile[];
  projectors: RemoteFile[];
  model: string | null;
  projector: string | null;
}

export type DownloadEvent = { modelId: string } & (
  | { state: 'progress'; downloadedBytes: number; totalBytes: number }
  | { state: 'verifying'; downloadedBytes: number; totalBytes: number }
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
