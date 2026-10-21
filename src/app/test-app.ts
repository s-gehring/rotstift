import { DEUTSCH, BUILT_IN_PROFILES } from '../annotations/profile.ts';
import { DEFAULT_SCOPE } from '../correction/scope.ts';
import { flattenPages } from '../import/arbeiten.ts';
import {
  CORRECTORS,
  defaultReviewer,
  MODELS,
  recommendModel,
  type AnyModelInfo,
} from '../models/registry.ts';
import { INITIAL_SETUP } from '../models/setup-state.ts';
import type { ModelStatus } from '../models/types.ts';
import type { ModelSetup } from '../models/use-model-setup.ts';
import { noDiagnostics } from '../pipeline/diagnostics.ts';
import { createRunner } from '../pipeline/runner.ts';
import { IDLE_ENGINE } from '../review/engine-phase.ts';
import { createReviewFlow } from '../review/review-flow.ts';
import { fixedWeighting, type WeightingModel } from '../stats/use-weighting.ts';
import type { Toasts } from '../ui/Toast.tsx';
import { KLASSE } from './navigation.ts';
import type {
  AppModel,
  ImportPages,
  Models,
  Navigation,
  RunController,
  Subject,
  Work,
} from './types.ts';

const noop = () => undefined;
const resolved = () => Promise.resolve();

export function testModelSetup<T extends AnyModelInfo>(
  model: T,
  status: ModelStatus | null = {
    modelId: model.id,
    state: 'ready',
    downloadedBytes: 0,
    totalBytes: 1,
  },
  overrides: Partial<ModelSetup<T>> = {},
): ModelSetup<T> {
  const models = (model.role === 'transcriber' ? MODELS : CORRECTORS) as readonly AnyModelInfo[];
  return {
    available: true,
    state: {
      ...INITIAL_SETUP,
      loaded: true,
      statuses: status === null ? {} : { [model.id]: status },
    },
    models: models.filter((candidate): candidate is T => candidate.role === model.role),
    model,
    status,
    error: null,
    loadError: null,
    samples: [],
    baseline: 0,
    select: resolved,
    download: resolved,
    cancel: resolved,
    remove: resolved,
    importFiles: resolved,
    refresh: resolved,
    verifyAgain: resolved,
    clearError: noop,
    ...overrides,
  };
}

export function testToasts(overrides: Partial<Toasts> = {}): Toasts {
  return { current: null, show: noop, dismiss: noop, ...overrides };
}

export function testWork(overrides: Partial<Work> = {}): Work {
  const runner = createRunner({
    render: (page) => Promise.resolve(new Blob([page.id])),
    diagnostics: noDiagnostics,
  });
  const flow = createReviewFlow({
    transcription: runner,
    locator: { locate: () => Promise.reject(new Error('nicht im Test')) },
    loadImage: () => Promise.reject(new Error('nicht im Test')),
  });
  return {
    count: { runner, state: runner.getState() },
    review: { flow, state: flow.getState() },
    transcriber: null,
    corrector: null,
    reviewer: null,
    engine: IDLE_ENGINE,
    canRetryCount: false,
    canRetryReview: false,
    ...overrides,
  };
}

export interface TestAppParts {
  readonly importState?: Partial<ImportPages>;
  readonly navigation?: Partial<Navigation>;
  readonly run?: Partial<RunController>;
  readonly subject?: Partial<Subject>;
  readonly weighting?: WeightingModel;
  readonly work?: Work;
  readonly models?: Partial<Models>;
  readonly toasts?: Toasts;
  readonly demo?: boolean;
}

export function testAppModel(parts: TestAppParts = {}): AppModel {
  const arbeiten = parts.importState?.arbeiten ?? [];
  const importState: ImportPages = {
    arbeiten,
    pages: flattenPages(arbeiten),
    dispatch: noop,
    addFiles: noop,
    busy: false,
    undo: noop,
    ...parts.importState,
  };
  const transcriber = testModelSetup(recommendModel());
  const corrector = testModelSetup(recommendModel(CORRECTORS));
  const reviewer = testModelSetup(defaultReviewer());
  return {
    importState,
    pages: importState.pages,
    navigation: {
      route: KLASSE,
      position: null,
      openArbeit: noop,
      back: noop,
      next: noop,
      prev: noop,
      overviewOpen: false,
      openOverview: noop,
      closeOverview: noop,
      ...parts.navigation,
    },
    run: {
      kind: 'correct',
      setKind: noop,
      running: false,
      stopping: false,
      progress: null,
      openPages: { count: importState.pages.length, correct: importState.pages.length },
      done: { count: false, correct: false },
      missingModels: { count: [], correct: [] },
      checking: false,
      unavailable: null,
      start: noop,
      cancel: noop,
      ...parts.run,
    },
    subject: {
      profile: DEUTSCH,
      profiles: BUILT_IN_PROFILES,
      select: noop,
      scope: DEFAULT_SCOPE,
      setScope: noop,
      missing: null,
      clearMissing: noop,
      ...parts.subject,
    },
    weighting: parts.weighting ?? fixedWeighting(),
    work: parts.work ?? testWork(),
    models: {
      transcriber,
      corrector,
      reviewer,
      switchLocked: { transcriber: false, corrector: false, reviewer: false },
      setup: { open: false, roles: [], pendingRun: null, show: noop, close: noop },
      settings: { open: false, show: noop, close: noop },
      ...parts.models,
    },
    toasts: parts.toasts ?? testToasts(),
    demo: parts.demo ?? false,
  };
}
