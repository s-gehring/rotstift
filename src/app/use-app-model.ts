import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BUILT_IN_PROFILES } from '../annotations/profile.ts';
import { useCorrector } from '../correction/use-corrector.ts';
import { useProfileChoice } from '../correction/use-profile-choice.ts';
import { flattenPages } from '../import/arbeiten.ts';
import { useImportPages } from '../import/use-import-pages.ts';
import { useModelSetup } from '../models/use-model-setup.ts';
import { browserModelClient, isTauri } from '../pipeline/environment.ts';
import type { ModelAvailability } from '../pipeline/provider.ts';
import { isCounting, isSwitchLocked } from '../pipeline/runner.ts';
import { useEnginePhase } from '../pipeline/use-engine-phase.ts';
import { useTranscriber } from '../pipeline/use-transcriber.ts';
import { useWordCount } from '../results/use-word-count.ts';
import { useMonitorPhase } from '../review/engine-phase.ts';
import { useReview } from '../review/use-review.ts';
import { useToast } from '../ui/Toast.tsx';
import { KLASSE, resolveRoute, routePosition, stepRoute } from './navigation.ts';
import {
  countFinishedText,
  loadRunKind,
  NEEDED_ROLES,
  openPageCount,
  readiness,
  reviewFinishedText,
  runProgress,
  saveRunKind,
  startDecision,
  type Readiness,
} from './run.ts';
import type { AppModel, ModelRole, Navigation, Route, RunKind } from './types.ts';

const modelClient = browserModelClient();

interface SetupState {
  readonly open: boolean;
  readonly roles: readonly ModelRole[];
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
  const importState = useImportPages();
  const toasts = useToast();
  const transcriberSetup = useModelSetup(modelClient);
  const { model } = transcriberSetup;
  const modelState = transcriberSetup.status?.state;
  const availability = useMemo<ModelAvailability | null>(
    () => (modelState === undefined ? null : { model, state: modelState }),
    [model, modelState],
  );
  const transcriber = useTranscriber(availability, () => {
    void transcriberSetup.refresh();
  });
  const count = useWordCount(importState.pages, transcriber);
  const transcriberPhase = useEnginePhase(transcriber);
  const correction = useCorrector(modelClient);
  const corrector = correction.status;
  const correctorSetup = correction.setup.setup;
  const correctorPhase = useMonitorPhase(
    corrector?.state === 'ready' ? corrector.engine : undefined,
  );
  const engine = useMemo(
    () => ({ transcriber: transcriberPhase, corrector: correctorPhase }),
    [transcriberPhase, correctorPhase],
  );
  const { profile, select: selectProfile } = useProfileChoice();
  const pages = useMemo(() => flattenPages(importState.arbeiten), [importState.arbeiten]);
  const review = useReview(count.runner, pages, corrector);
  const navigation = useNavigation(importState.arbeiten);

  const reviewing = review.state.run !== null;
  const running = reviewing || isCounting(count.state);
  const now = useNow(running);

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
  };
  const rolesWith = (wanted: RunKind, state: Readiness) =>
    NEEDED_ROLES[wanted].filter((role) => roleReadiness[role] === state);
  const missingModels = {
    count: rolesWith('count', 'missing'),
    correct: rolesWith('correct', 'missing'),
  };
  const unavailableText = (wanted: RunKind) => {
    if (rolesWith(wanted, 'unavailable').length === 0) return null;
    if (transcriber?.state === 'unavailable') return transcriber.message;
    return corrector?.state === 'unavailable' ? corrector.message : null;
  };

  const openPages = {
    count: openPageCount('count', pages, count.state, review.state, profile),
    correct: openPageCount('correct', pages, count.state, review.state, profile),
  };

  const cancelled = useRef(false);
  const launch = (wanted: RunKind) => {
    cancelled.current = false;
    if (wanted === 'count') count.runner.start();
    else void review.flow.start(pages, profile);
  };

  const start = (wanted: RunKind = kind) => {
    if (wanted !== kind) setKind(wanted);
    if (running || pages.length === 0) return;
    const decision = startDecision(wanted, roleReadiness);
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
  const setupDone =
    setupState.open &&
    setupState.roles.every((role) => roleReadiness[role] === 'ready') &&
    (pendingRun === null ||
      NEEDED_ROLES[pendingRun].every((role) => roleReadiness[role] === 'ready'));
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
  }, [afterSetup, show]);

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
        ? (runProgress(review.state, count.state, engine, now) ?? {
            label: 'Texterkennung …',
            detail: null,
            value: null,
            max: 1,
          })
        : null,
      openPages,
      done: {
        count: pages.length > 0 && openPages.count === 0,
        correct: pages.length > 0 && openPages.correct === 0,
      },
      missingModels,
      checking: rolesWith(kind, 'checking').length > 0,
      unavailable: unavailableText(kind),
      start,
      cancel,
    },
    subject: { profile, profiles: BUILT_IN_PROFILES, select: selectProfile },
    work: {
      count,
      review,
      transcriber,
      corrector,
      engine,
      canRetryCount: transcriber?.state === 'ready' && !reviewing,
      canRetryReview: transcriber?.state === 'ready' && corrector?.state === 'ready',
    },
    models: {
      transcriber: transcriberSetup,
      corrector: correctorSetup,
      switchLocked: {
        transcriber: isSwitchLocked(count.state, transcriberPhase) || reviewing,
        corrector: reviewing,
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
    toasts,
    demo: import.meta.env.DEV || !isTauri(),
  };
}
