import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BUILT_IN_PROFILES } from '../annotations/profile.ts';
import { createCloudClient } from '../cloud/client.ts';
import { cloudBlockedMessage, cloudUsable, remoteTranscriber } from '../cloud/remote.ts';
import { useCloud } from '../cloud/use-cloud.ts';
import { needsAssignment, needsFormName } from '../content-form/review.ts';
import { useCorrectionScope } from '../correction/use-correction-scope.ts';
import { useCorrector, useReviewer } from '../correction/use-corrector.ts';
import { useProfileChoice } from '../correction/use-profile-choice.ts';
import { flattenPages } from '../import/arbeiten.ts';
import { useImportPages } from '../import/use-import-pages.ts';
import { useModelSetup, useSecondReaderSetup } from '../models/use-model-setup.ts';
import { useSecondReading } from '../models/use-second-reading.ts';
import { browserModelClient, isTauri } from '../pipeline/environment.ts';
import type { ModelAvailability } from '../pipeline/provider.ts';
import { isCounting, isSwitchLocked, type Runner } from '../pipeline/runner.ts';
import { useEnginePhase } from '../pipeline/use-engine-phase.ts';
import { useTranscriber } from '../pipeline/use-transcriber.ts';
import { useWordCount } from '../results/use-word-count.ts';
import { useMonitorPhase } from '../review/engine-phase.ts';
import { reviewWorks, type ReviewFlow } from '../review/review-flow.ts';
import { useReview } from '../review/use-review.ts';
import { useGrading } from '../stats/use-grading.ts';
import { useWeighting } from '../stats/use-weighting.ts';
import { useToast } from '../ui/Toast.tsx';
import { stepCosts, type StepCosts } from '../models/speed.ts';
import {
  createEstimator,
  durationText,
  endRun,
  type Estimator,
  learn,
  type LearnedRates,
  loadRates,
  observe,
  ratesFor,
  saveRates,
  totalSeconds,
} from './estimate.ts';
import { KLASSE, resolveRoute, routePosition, stepRoute } from './navigation.ts';
import { previewProtection, useShields } from './use-shields.ts';
import { secondReaderReadiness, withSecondReader } from './second-reading.ts';
import {
  countFinishedText,
  createPowerHold,
  loadRunKind,
  neededRoles,
  openPageCount,
  readiness,
  reviewFinishedText,
  runProgress,
  runSnapshot,
  saveRunKind,
  startDecision,
  startRun,
  startWorkload,
  type Readiness,
  type RunStart,
} from './run.ts';
import type {
  AppModel,
  ModelRole,
  Navigation,
  PrivacyReview,
  Route,
  RunKind,
  ScopeField,
  SetupRole,
} from './types.ts';

const modelClient = browserModelClient();
const cloudClient = modelClient === null ? null : createCloudClient();
const shieldPreview = modelClient === null && import.meta.env.DEV && previewProtection();

interface SetupState {
  readonly open: boolean;
  readonly roles: readonly SetupRole[];
  readonly pendingRun: RunKind | null;
}

const SETUP_CLOSED: SetupState = { open: false, roles: [], pendingRun: null };

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

interface RunClock {
  readonly start: RunStart | null;
  readonly estimator: Estimator;
  readonly learned: LearnedRates;
}

function useRunClock(
  flow: ReviewFlow,
  runner: Runner,
  arbeiten: AppModel['importState']['arbeiten'],
  costs: StepCosts,
): RunClock {
  const [clock, setClock] = useState<RunClock>(() => ({
    start: null,
    estimator: createEstimator(),
    learned: loadRates(),
  }));
  const costsRef = useRef(costs);
  useEffect(() => {
    costsRef.current = costs;
  });
  useEffect(() => {
    const update = () => {
      const review = flow.getState();
      const count = runner.getState();
      const at = performance.now();
      setClock((current) => {
        const start =
          review.run === null ? null : (current.start ?? startRun(review, count, at, arbeiten));
        const snapshot = runSnapshot(review, count, start);
        const seeded =
          snapshot !== null && current.estimator.mark === null
            ? createEstimator(ratesFor(current.learned, costsRef.current))
            : current.estimator;
        const estimator = snapshot === null ? endRun(seeded) : observe(seeded, snapshot, at);
        const learned =
          snapshot === null
            ? current.learned
            : learn(current.learned, costsRef.current, estimator.rates);
        return start === current.start &&
          estimator === current.estimator &&
          learned === current.learned
          ? current
          : { start, estimator, learned };
      });
    };
    const unsubscribe = [flow.subscribe(update), runner.subscribe(update)];
    return () => {
      for (const stop of unsubscribe) stop();
    };
  }, [flow, runner, arbeiten]);
  const { learned } = clock;
  useEffect(() => saveRates(learned), [learned]);
  return clock;
}

function usePrivacyReview(flow: ReviewFlow, works: PrivacyReview['works']): PrivacyReview {
  const [open, setOpen] = useState(false);
  const [shownFor, setShownFor] = useState<PrivacyReview['works']>(null);
  const active = works !== null;
  if (active !== (shownFor !== null)) {
    setShownFor(works);
    setOpen(active);
  }
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  return useMemo(
    () => ({
      works,
      open: open && active,
      show,
      close,
      add: flow.addIdentifier,
      remove: flow.removeIdentifier,
      release: flow.release,
    }),
    [works, open, active, show, close, flow],
  );
}

function useNavigation(arbeiten: AppModel['importState']['arbeiten']): Navigation {
  const [stored, setRoute] = useState<Route>(KLASSE);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const route = resolveRoute(stored, arbeiten);
  return {
    route,
    position: routePosition(route, arbeiten),
    openArbeit: (arbeitId) => {
      setOverviewOpen(false);
      setRoute({ view: 'arbeit', arbeitId });
    },
    back: () => setRoute(KLASSE),
    next: () => setRoute(stepRoute(route, arbeiten, 1)),
    prev: () => setRoute(stepRoute(route, arbeiten, -1)),
    overviewOpen,
    openOverview: () => setOverviewOpen(true),
    closeOverview: () => setOverviewOpen(false),
  };
}

export function useAppModel(): AppModel {
  const toasts = useToast();
  const { show: showToast } = toasts;
  const importState = useImportPages({
    onProblem: (text) => showToast(text, { tone: 'error' }),
  });
  const cloud = useCloud(cloudClient);
  const transcriberCloud = cloud.steps.transcriber ?? null;
  const transcriberSetup = useModelSetup(modelClient);
  const secondReaderSetup = useSecondReaderSetup(modelClient);
  const secondReading = useSecondReading();
  const { model } = transcriberSetup;
  const modelState = transcriberSetup.status?.state;
  const secondModel =
    secondReading.enabled && secondReaderSetup.status?.state === 'ready'
      ? secondReaderSetup.model
      : null;
  const availability = useMemo<ModelAvailability | null>(() => {
    if (transcriberCloud !== null) {
      return cloudUsable(transcriberCloud, 'transcriber')
        ? { model: remoteTranscriber(transcriberCloud), state: 'ready', remote: true }
        : null;
    }
    return modelState === undefined ? null : { model, state: modelState, second: secondModel };
  }, [model, modelState, transcriberCloud, secondModel]);
  const resolvedTranscriber = useTranscriber(availability, () => {
    void transcriberSetup.refresh();
  });
  const transcriber = useMemo(
    () =>
      transcriberCloud !== null && !cloudUsable(transcriberCloud, 'transcriber')
        ? {
            state: 'unavailable' as const,
            message: cloudBlockedMessage(transcriberCloud, 'transcriber'),
          }
        : resolvedTranscriber,
    [transcriberCloud, resolvedTranscriber],
  );
  const count = useWordCount(importState.pages, transcriber);
  const transcriberPhase = useEnginePhase(transcriber);
  const correction = useCorrector(modelClient, undefined, cloud.steps.corrector ?? null);
  const corrector = correction.status;
  const correctorSetup = correction.setup.setup;
  const correctorPhase = useMonitorPhase(
    corrector?.state === 'ready' ? corrector.engine : undefined,
  );
  const contentForm = useReviewer(modelClient, undefined, cloud.steps.reviewer ?? null);
  const reviewer = contentForm.status;
  const reviewerSetup = contentForm.setup.setup;
  const reviewerPhase = useMonitorPhase(reviewer?.state === 'ready' ? reviewer.engine : undefined);
  const engine = useMemo(
    () => ({ transcriber: transcriberPhase, corrector: correctorPhase, reviewer: reviewerPhase }),
    [transcriberPhase, correctorPhase, reviewerPhase],
  );
  const { profile, select: selectProfile } = useProfileChoice();
  const { scope, setScope } = useCorrectionScope(importState.arbeiten.length > 0);
  const [missing, setMissing] = useState<ScopeField | null>(null);
  const clearMissing = useCallback(() => setMissing(null), []);
  const weighting = useWeighting();
  const grading = useGrading();
  const pages = useMemo(() => flattenPages(importState.arbeiten), [importState.arbeiten]);
  const review = useReview(count.runner, pages, corrector, reviewer, importState.arbeiten);
  const shields = useShields(cloud, shieldPreview ? { corrector, reviewer } : null);
  useEffect(() => {
    review.flow.setShields(shields);
  }, [review.flow, shields]);
  const privacy = usePrivacyReview(review.flow, review.state.privacy ?? null);
  const navigation = useNavigation(importState.arbeiten);

  const reviewing = review.state.run !== null;
  const running = reviewing || isCounting(count.state);
  const now = useNow(running);
  const powerHold = useMemo(() => (isTauri() ? createPowerHold() : null), []);
  useEffect(() => {
    powerHold?.set(running);
  }, [powerHold, running]);
  useEffect(() => () => powerHold?.set(false), [powerHold]);
  const costs = stepCosts(
    {
      transcriber: transcriberCloud === null ? model : null,
      second: transcriberCloud === null && secondReading.enabled ? secondReaderSetup.model : null,
      corrector: cloud.steps.corrector === undefined ? correctorSetup.model : null,
      reviewer: cloud.steps.reviewer === undefined ? reviewerSetup.model : null,
      correctorDraft: correctorSetup.status?.draftReady === true,
    },
    transcriberSetup.state.hardware?.totalRamBytes ?? null,
  );
  const {
    start: runStart,
    estimator,
    learned,
  } = useRunClock(review.flow, count.runner, importState.arbeiten, costs);
  const rates = ratesFor(learned, costs);

  const [kind, setStoredKind] = useState<RunKind>(() => loadRunKind());
  const setKind = useCallback((next: RunKind) => {
    setStoredKind(next);
    saveRunKind(next);
  }, []);

  const [setupState, setSetupState] = useState<SetupState>(SETUP_CLOSED);
  const [afterSetup, setAfterSetup] = useState<{ readonly run: RunKind | null } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const roleReadiness: Readonly<Record<ModelRole, Readiness>> = {
    transcriber: readiness(transcriber, transcriberSetup.loadError),
    corrector: readiness(corrector, correctorSetup.loadError),
    reviewer: readiness(reviewer, reviewerSetup.loadError),
  };
  const secondReadiness = secondReaderReadiness(
    secondReaderSetup,
    secondReading.enabled && transcriberCloud === null,
  );
  const rolesWith = (wanted: RunKind, state: Readiness) =>
    neededRoles(wanted, scope).filter((role) => roleReadiness[role] === state);
  const secondFor = (wanted: RunKind): Readiness =>
    wanted === 'correct' ? secondReadiness : 'ready';
  const missingModels: Readonly<Record<RunKind, readonly SetupRole[]>> = {
    count: rolesWith('count', 'missing'),
    correct: [
      ...rolesWith('correct', 'missing'),
      ...(secondReadiness === 'missing' ? (['secondReader'] as const) : []),
    ],
  };
  const unavailableText = (wanted: RunKind) => {
    if (rolesWith(wanted, 'unavailable').length === 0) return null;
    const statuses = { transcriber, corrector, reviewer };
    for (const role of rolesWith(wanted, 'unavailable')) {
      const status = statuses[role];
      if (status?.state === 'unavailable') return status.message;
    }
    return null;
  };

  const estimateText = (wanted: RunKind) => {
    const work = startWorkload(
      wanted,
      pages,
      importState.arbeiten,
      count.state,
      review.state,
      profile,
      scope,
      costs.confirm.key !== 'none',
    );
    return durationText(totalSeconds(rates, work));
  };

  const openPages = {
    count: openPageCount('count', pages, count.state, review.state, profile),
    correct: openPageCount('correct', pages, count.state, review.state, profile),
  };

  const estimates = {
    count: estimateText('count'),
    correct: estimateText('correct'),
  };

  const cancelled = useRef(false);
  const launch = (wanted: RunKind) => {
    cancelled.current = false;
    if (wanted === 'count') count.runner.start();
    else void review.flow.start(pages, profile, scope, reviewWorks(importState.arbeiten));
  };

  const start = (wanted: RunKind = kind) => {
    if (wanted !== kind) setKind(wanted);
    if (running || pages.length === 0) return;
    if (wanted === 'correct' && (needsAssignment(scope) || needsFormName(scope))) {
      setMissing(needsFormName(scope) ? 'formName' : 'assignment');
      return;
    }
    const decision = withSecondReader(
      startDecision(wanted, roleReadiness, scope),
      secondFor(wanted),
    );
    if (decision.action === 'unavailable') {
      const message = unavailableText(wanted);
      if (message !== null) toasts.show(message, { tone: 'error' });
    } else if (decision.action === 'setup') {
      setSetupState({ open: true, roles: decision.roles, pendingRun: wanted });
    } else if (decision.action === 'launch') {
      launch(wanted);
    }
  };

  const cancel = () => {
    cancelled.current = true;
    if (reviewing) review.flow.cancel();
    else count.runner.cancel();
  };

  const { show } = toasts;
  const pendingRun = setupState.open ? setupState.pendingRun : null;
  const setupReady = (role: SetupRole) =>
    (role === 'secondReader' ? secondReadiness : roleReadiness[role]) === 'ready';
  const setupDone =
    setupState.open &&
    setupState.roles.every(setupReady) &&
    (pendingRun === null ||
      (neededRoles(pendingRun, scope).every(setupReady) && secondFor(pendingRun) === 'ready'));
  const launchRef = useRef(launch);
  useEffect(() => {
    launchRef.current = launch;
  });
  if (setupDone) {
    setSetupState(SETUP_CLOSED);
    setAfterSetup({ run: pendingRun });
  }
  useEffect(() => {
    if (afterSetup === null) return;
    if (afterSetup.run === null) show('Eingerichtet.');
    else launchRef.current(afterSetup.run);
  }, [afterSetup, show, launchRef]);

  const wasRunning = useRef<'count' | 'correct' | null>(null);
  const finishedRef = useRef({
    arbeiten: importState.arbeiten,
    count: count.state,
    review: review.state,
  });
  useEffect(() => {
    finishedRef.current = {
      arbeiten: importState.arbeiten,
      count: count.state,
      review: review.state,
    };
  });
  const activeRun = reviewing ? 'correct' : running ? 'count' : null;
  useEffect(() => {
    const previous = wasRunning.current;
    wasRunning.current = activeRun;
    if (previous === null || activeRun !== null) return;
    const latest = finishedRef.current;
    if (previous === 'correct' ? latest.review.outcome === 'cancelled' : cancelled.current) {
      show('Abgebrochen.');
    } else {
      show(
        previous === 'correct'
          ? reviewFinishedText(latest.arbeiten, latest.review, latest.count)
          : countFinishedText(latest.arbeiten, latest.count),
      );
    }
    cancelled.current = false;
  }, [activeRun, show]);

  return {
    importState,
    pages,
    navigation,
    run: {
      kind,
      setKind,
      running,
      stopping: review.state.stopping,
      progress: running
        ? (runProgress(review.state, count.state, engine, now, runStart, estimator) ?? {
            label: 'Wird vorbereitet …',
            detail: null,
            value: null,
            max: 1,
          })
        : null,
      openPages,
      estimates,
      done: {
        count: pages.length > 0 && openPages.count === 0,
        correct: pages.length > 0 && openPages.correct === 0,
      },
      missingModels,
      checking: rolesWith(kind, 'checking').length > 0 || secondFor(kind) === 'checking',
      unavailable: unavailableText(kind),
      start,
      cancel,
    },
    subject: {
      profile,
      profiles: BUILT_IN_PROFILES,
      select: selectProfile,
      scope,
      setScope,
      missing,
      clearMissing,
    },
    weighting,
    grading,
    work: {
      count,
      review,
      transcriber,
      corrector,
      reviewer,
      engine,
      canRetryCount: transcriber?.state === 'ready' && !reviewing,
      canRetryReview: neededRoles('correct', scope).every(
        (role) => roleReadiness[role] === 'ready',
      ),
    },
    models: {
      transcriber: transcriberSetup,
      corrector: correctorSetup,
      reviewer: reviewerSetup,
      secondReader: secondReaderSetup,
      secondReading,
      cloud,
      switchLocked: {
        transcriber: isSwitchLocked(count.state, transcriberPhase) || reviewing,
        corrector: reviewing,
        reviewer: reviewing,
      },
      setup: {
        ...setupState,
        show: (roles, run) => setSetupState({ open: true, roles, pendingRun: run ?? null }),
        close: () => setSetupState(SETUP_CLOSED),
      },
      settings: {
        open: settingsOpen,
        show: () => setSettingsOpen(true),
        close: () => setSettingsOpen(false),
      },
    },
    privacy,
    toasts,
    preview: import.meta.env.DEV || !isTauri(),
  };
}
