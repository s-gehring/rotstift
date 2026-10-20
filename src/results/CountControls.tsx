import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { findPage, flattenPages, type Arbeit } from '../import/arbeiten.ts';
import { describeDownloadError, formatMegabytes } from '../models/format.ts';
import { CheckProgress, checkText } from '../models/ModelCheck.tsx';
import type { DownloadError, ModelStatus } from '../models/types.ts';
import { describeProgress, formatRemaining } from '../pipeline/progress.ts';
import { startablePages } from '../pipeline/runner.ts';
import type { ModelProblem, TranscriberStatus } from '../pipeline/transcriber.ts';
import { useEnginePhase } from '../pipeline/use-engine-phase.ts';
import { buildResults, classTotals, pagesText, wordsText } from './summary.ts';
import type { WordCount } from './use-word-count.ts';

interface CountProps {
  readonly count: WordCount;
  readonly status: TranscriberStatus | null;
  readonly arbeiten: readonly Arbeit[];
}

interface ControlProps extends CountProps {
  readonly onSetup?: () => void;
  readonly locked?: boolean;
  readonly children?: ReactNode;
}

interface HintProps extends CountProps {
  readonly download?: ModelStatus | null;
  readonly loadError?: DownloadError | null;
  readonly onRetry?: () => void;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function finishedText(arbeiten: readonly Arbeit[], count: WordCount): string {
  const results = buildResults(arbeiten, count.state.entries);
  const totals = classTotals(results);
  const failed = results
    .flatMap((result) => result.rows)
    .filter((row) => row.status === 'error').length;
  const parts = [
    `Fertig: ${wordsText(totals.words)} auf ${pagesText(totals.countedPages)}.`,
    failed > 0 ? `${pagesText(failed)} nicht erkannt.` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

export function CountControls({
  count,
  status,
  arbeiten,
  onSetup,
  locked = false,
  children,
}: ControlProps) {
  const pages = useMemo(() => flattenPages(arbeiten), [arbeiten]);
  const { runner, state } = count;
  const running = state.batch !== null;
  const now = useNow(running);
  const progress = describeProgress(state, now);
  const phase = useEnginePhase(status);
  const [announcement, setAnnouncement] = useState('');
  const wasRunning = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (wasRunning.current && !running) {
      setAnnouncement(cancelled.current ? 'Abgebrochen.' : finishedText(arbeiten, count));
      cancelled.current = false;
    }
    wasRunning.current = running;
  }, [running, arbeiten, count]);

  const nothingToDo =
    pages.length > 0 &&
    Object.keys(state.entries).length > 0 &&
    startablePages(pages, state).queue.length === 0;
  const disabled = status?.state !== 'ready' || pages.length === 0 || nothingToDo;

  const cancel = () => {
    cancelled.current = true;
    runner.cancel();
  };

  let message = announcement;
  if (progress !== null && phase === 'starting') {
    message = 'Texterkennung startet …';
  } else if (progress !== null) {
    const remaining =
      progress.remainingMs === null
        ? 'Restzeit wird geschätzt …'
        : `noch ${formatRemaining(progress.remainingMs)}`;
    message = `Seite ${progress.current} von ${progress.total} · ${remaining}`;
  }

  return (
    <>
      <button
        type="button"
        className="primary"
        disabled={locked || (!running && disabled)}
        aria-describedby="count-hint"
        onClick={running ? cancel : runner.start}
      >
        {running ? 'Abbrechen' : 'Wörter zählen'}
      </button>
      {children}
      {status?.state === 'needs-model' && (
        <button type="button" onClick={onSetup}>
          {SETUP_BUTTON[status.problem]}
        </button>
      )}
      <p className="progress" role="status">
        {message}
      </p>
    </>
  );
}

const SETUP_BUTTON: Record<ModelProblem, string> = {
  missing: 'Texterkennung einrichten',
  downloading: 'Download läuft …',
  verifying: 'Wird geprüft …',
  importing: 'Wird importiert …',
  deleting: 'Wird gelöscht …',
  corrupt: 'Texterkennung einrichten',
};

function modelProblemText(problem: ModelProblem, download: ModelStatus | null): string {
  switch (problem) {
    case 'missing':
      return 'Zum Wörterzählen muss einmalig die Texterkennung eingerichtet werden. Danach funktioniert alles offline.';
    case 'downloading':
      return download === null
        ? 'Die Texterkennung wird heruntergeladen.'
        : `Die Texterkennung wird heruntergeladen (${formatMegabytes(download.downloadedBytes)} von ${formatMegabytes(download.totalBytes)}).`;
    case 'importing':
      return 'Die Texterkennung wird gerade aus Dateien importiert. Das dauert einen Moment.';
    case 'deleting':
      return 'Die Texterkennung wird gerade gelöscht.';
    case 'verifying':
      return checkText('die Dateien der Texterkennung', download);
    case 'corrupt':
      return 'Die Texterkennung ist beschädigt und muss neu eingerichtet werden.';
    default: {
      const unreachable: never = problem;
      return unreachable;
    }
  }
}

export function CountHint({ count, status, arbeiten, download, loadError, onRetry }: HintProps) {
  const pages = useMemo(() => flattenPages(arbeiten), [arbeiten]);
  const messages: { text: string; demo?: boolean; retry?: boolean; check?: boolean }[] = [];
  if (status === null && loadError != null) {
    messages.push({
      text: `Rotstift konnte die Texterkennung nicht laden. ${describeDownloadError(loadError)}`,
      retry: true,
    });
  } else if (status === null) {
    messages.push({ text: 'Texterkennung wird geladen …' });
  } else if (status.state === 'needs-model') {
    messages.push({
      text: modelProblemText(status.problem, download ?? null),
      check: status.problem === 'verifying',
    });
  } else if (status.state === 'unavailable') {
    messages.push({ text: `Wörter zählen ist gerade nicht möglich. ${status.message}` });
  } else {
    if (status.demo) {
      messages.push({
        text: 'Demo-Modus: Statt einer echten Erkennung liefert die Entwicklungsumgebung Platzhalter („Demo-Text“).',
        demo: true,
      });
    }
    const { queue, skippedEdited } = startablePages(pages, count.state);
    if (queue.length === 0 && Object.keys(count.state.entries).length > 0 && pages.length > 0) {
      const skipped = skippedEdited.flatMap((page) => {
        const found = findPage(arbeiten, page.id);
        return found === undefined ? [] : [`Seite ${found.index + 1} von ${found.arbeit.name}`];
      });
      messages.push({
        text:
          skipped.length === 0
            ? 'Alle Seiten sind gezählt.'
            : `Alle Seiten sind gezählt. ${skipped.join(', ')} wurde nach Ihrer Bearbeitung gedreht und nicht neu erkannt.`,
      });
    }
  }

  return (
    <div id="count-hint">
      {messages.map((message) => (
        <p key={message.text} className={message.demo ? 'notice demo' : 'notice'}>
          {message.text}
          {message.retry && onRetry !== undefined && (
            <>
              {' '}
              <button type="button" onClick={onRetry}>
                Erneut versuchen
              </button>
            </>
          )}
          {message.check && (
            <CheckProgress status={download ?? null} label="Prüfung der Texterkennung" />
          )}
        </p>
      ))}
    </div>
  );
}
