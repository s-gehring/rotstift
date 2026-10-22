import type { CorrectionProfile } from '../annotations/profile.ts';
import type { CloudModel } from '../cloud/use-cloud.ts';
import type { CorrectorStatus } from '../correction/provider.ts';
import type { CorrectionScope } from '../correction/scope.ts';
import type { ImportPage } from '../import/pages.ts';
import type { useImportPages } from '../import/use-import-pages.ts';
import type { CorrectorInfo } from '../models/registry.ts';
import type { ModelSetup } from '../models/use-model-setup.ts';
import type { TranscriberStatus } from '../pipeline/transcriber.ts';
import type { WordCount } from '../results/use-word-count.ts';
import type { ReviewEngine } from '../review/engine-phase.ts';
import type { Review } from '../review/use-review.ts';
import type { GradingModel } from '../stats/use-grading.ts';
import type { WeightingModel } from '../stats/use-weighting.ts';
import type { Toasts } from '../ui/Toast.tsx';

export type RunKind = 'correct' | 'count';

export type ModelRole = 'transcriber' | 'corrector' | 'reviewer';

export type Route =
  { readonly view: 'klasse' } | { readonly view: 'arbeit'; readonly arbeitId: string };

export type ImportPages = ReturnType<typeof useImportPages>;

export interface ArbeitPosition {
  readonly index: number;
  readonly total: number;
}

export interface Navigation {
  readonly route: Route;
  readonly position: ArbeitPosition | null;
  readonly openArbeit: (arbeitId: string) => void;
  readonly back: () => void;
  readonly next: () => void;
  readonly prev: () => void;
  readonly overviewOpen: boolean;
  readonly openOverview: () => void;
  readonly closeOverview: () => void;
}

export interface RunProgress {
  readonly label: string;
  readonly detail: string | null;
  readonly value: number | null;
  readonly max: number;
}

export interface RunController {
  readonly kind: RunKind;
  readonly setKind: (kind: RunKind) => void;
  readonly running: boolean;
  readonly stopping: boolean;
  readonly progress: RunProgress | null;
  readonly openPages: Readonly<Record<RunKind, number>>;
  readonly estimates: Readonly<Record<RunKind, string | null>>;
  readonly done: Readonly<Record<RunKind, boolean>>;
  readonly missingModels: Readonly<Record<RunKind, readonly ModelRole[]>>;
  readonly checking: boolean;
  readonly unavailable: string | null;
  readonly start: (kind?: RunKind) => void;
  readonly cancel: () => void;
}

export interface Subject {
  readonly profile: CorrectionProfile;
  readonly profiles: readonly CorrectionProfile[];
  readonly select: (profile: CorrectionProfile) => void;
  readonly scope: CorrectionScope;
  readonly setScope: (scope: CorrectionScope) => void;
  readonly missing: ScopeField | null;
  readonly clearMissing: () => void;
}

export type ScopeField = 'assignment' | 'formName';

export interface Work {
  readonly count: WordCount;
  readonly review: Review;
  readonly transcriber: TranscriberStatus | null;
  readonly corrector: CorrectorStatus | null;
  readonly reviewer: CorrectorStatus | null;
  readonly engine: ReviewEngine;
  readonly canRetryCount: boolean;
  readonly canRetryReview: boolean;
}

export interface SetupRequest {
  readonly open: boolean;
  readonly roles: readonly ModelRole[];
  readonly pendingRun: RunKind | null;
  readonly show: (roles: readonly ModelRole[], pendingRun?: RunKind) => void;
  readonly close: () => void;
}

export interface SettingsRequest {
  readonly open: boolean;
  readonly show: () => void;
  readonly close: () => void;
}

export interface Models {
  readonly transcriber: ModelSetup;
  readonly corrector: ModelSetup<CorrectorInfo>;
  readonly reviewer: ModelSetup<CorrectorInfo>;
  readonly cloud: CloudModel;
  readonly switchLocked: Readonly<Record<ModelRole, boolean>>;
  readonly setup: SetupRequest;
  readonly settings: SettingsRequest;
}

export interface AppModel {
  readonly importState: ImportPages;
  readonly pages: readonly ImportPage[];
  readonly navigation: Navigation;
  readonly run: RunController;
  readonly subject: Subject;
  readonly weighting: WeightingModel;
  readonly grading: GradingModel;
  readonly work: Work;
  readonly models: Models;
  readonly toasts: Toasts;
  readonly demo: boolean;
}
