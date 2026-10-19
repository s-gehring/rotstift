import { describeProgress, formatRemaining } from '../pipeline/progress.ts';
import type { TranscriberStatus } from '../pipeline/transcriber.ts';
import type { WordCount } from './use-word-count.ts';

interface CountControlsProps {
  readonly count: WordCount;
  readonly status: TranscriberStatus | null;
  readonly pageCount: number;
}

export function CountControls({ count, status, pageCount }: CountControlsProps) {
  const { runner, state } = count;
  const progress = describeProgress(state);
  const ready = status?.state === 'ready';

  if (progress !== null) {
    return (
      <>
        <button type="button" className="primary" onClick={runner.cancel}>
          Abbrechen
        </button>
        <p className="progress" role="status">
          Seite {progress.current} von {progress.total}
          {' · '}
          {progress.remainingMs === null
            ? 'Restzeit wird geschätzt …'
            : `noch ${formatRemaining(progress.remainingMs)}`}
        </p>
      </>
    );
  }

  return (
    <button
      type="button"
      className="primary"
      disabled={!ready || pageCount === 0}
      aria-describedby={ready ? undefined : 'count-hint'}
      onClick={runner.start}
    >
      Wörter zählen
    </button>
  );
}

export function CountNotice({ status }: { readonly status: TranscriberStatus | null }) {
  if (status === null) return null;
  if (status.state === 'unavailable') {
    return (
      <p id="count-hint" className="notice" role="status">
        Wörter zählen ist gerade nicht möglich. {status.message}
      </p>
    );
  }
  return status.demo ? (
    <p id="count-hint" className="notice demo" role="status">
      Demo-Modus: Statt einer echten Erkennung liefert die Entwicklungsumgebung Platzhalter
      („Demo-Text“).
    </p>
  ) : null;
}
