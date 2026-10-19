import { useEffect, useRef, useState } from 'react';
import { rotatedSize, type ImportPage } from '../import/pages.ts';
import { isOutdated, type PageEntry } from '../pipeline/runner.ts';
import { describeError } from '../pipeline/transcriber.ts';
import {
  buildRows,
  countedPages,
  formatCount,
  formatSummary,
  totalWords,
  wordsText,
  type ResultRow,
} from './summary.ts';
import type { WordCount } from './use-word-count.ts';

const STAGE = 144;

const STATUS_TEXT = {
  waiting: 'wartet',
  running: 'läuft …',
  done: 'fertig',
  error: 'Fehler',
} as const;

interface ResultsViewProps {
  readonly pages: readonly ImportPage[];
  readonly count: WordCount;
  readonly canRetry: boolean;
}

function Thumbnail({ page }: { readonly page: ImportPage }) {
  const visible = rotatedSize(page);
  const scale = Math.min(STAGE / visible.width, STAGE / visible.height);
  return (
    <div className="result-stage">
      <img
        src={page.thumbnailUrl}
        alt=""
        draggable={false}
        style={{
          width: page.width * scale,
          height: page.height * scale,
          transform: `translate(-50%, -50%) rotate(${page.rotation}deg)`,
        }}
      />
    </div>
  );
}

interface ResultCardProps {
  readonly page: ImportPage;
  readonly row: ResultRow;
  readonly entry: PageEntry;
  readonly canRetry: boolean;
  readonly onEdit: (text: string) => void;
  readonly onRetry: () => void;
}

function ResultCard({ page, row, entry, canRetry, onEdit, onRetry }: ResultCardProps) {
  const [confirming, setConfirming] = useState(false);
  const keepButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) keepButton.current?.focus();
  }, [confirming]);

  const outdated = isOutdated(entry, page);
  const queued = entry.status === 'waiting' || entry.status === 'running';
  const retryable = !queued && (entry.error !== null || outdated);
  const retryLabel = entry.error === null ? 'Neu erkennen' : 'Erneut versuchen';
  const overwritesEdits = entry.edited && entry.hasTranscript;

  const retry = () => {
    if (overwritesEdits) setConfirming(true);
    else onRetry();
  };

  return (
    <li className="result-card" data-status={row.status}>
      <Thumbnail page={page} />
      <div className="result-body">
        <div className="result-head">
          <h3>
            Seite {row.position} <span className="page-label">{row.label}</span>
          </h3>
          <span className="status" data-status={row.status}>
            {STATUS_TEXT[row.status]}
          </span>
          {row.words !== null && (
            <span className="words" data-testid="page-words">
              {wordsText(row.words)}
            </span>
          )}
        </div>
        {entry.hasTranscript && (
          <textarea
            aria-label={`Transkript von Seite ${row.position}`}
            value={entry.text}
            readOnly={entry.status !== 'done'}
            rows={Math.min(Math.max(entry.text.split('\n').length + 1, 4), 16)}
            spellCheck={false}
            onChange={(event) => onEdit(event.target.value)}
          />
        )}
        {entry.error !== null && (
          <p className="error-text">
            {describeError(entry.error)}
            {entry.hasTranscript && ' Das bisherige Transkript bleibt erhalten.'}
          </p>
        )}
        {outdated && (
          <p className="hint">
            Die Seite wurde nach der Erkennung gedreht. Das Transkript passt vielleicht nicht mehr.
          </p>
        )}
        {confirming ? (
          <div className="confirm">
            <p role="status">
              Ihre Änderungen an Seite {row.position} gehen verloren. Trotzdem neu erkennen?
            </p>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onRetry();
              }}
            >
              Trotzdem neu erkennen
            </button>
            <button type="button" ref={keepButton} onClick={() => setConfirming(false)}>
              Änderungen behalten
            </button>
          </div>
        ) : (
          retryable && (
            <button type="button" disabled={!canRetry} onClick={retry}>
              {retryLabel}
            </button>
          )
        )}
      </div>
    </li>
  );
}

export function ResultsView({ pages, count, canRetry }: ResultsViewProps) {
  const { runner, state } = count;
  const [copyMessage, setCopyMessage] = useState('');
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const rows = buildRows(pages, state.entries);
  if (rows.length === 0) return null;

  const counted = countedPages(rows);
  const total = totalWords(rows);

  const copy = () => {
    navigator.clipboard.writeText(formatSummary(rows, pages.length)).then(
      () => setCopyMessage('Ergebnis kopiert.'),
      () => setCopyMessage('Kopieren war nicht möglich.'),
    );
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyMessage(''), 4000);
  };

  return (
    <section className="results" aria-labelledby="results-title">
      <div className="results-header">
        <h2 id="results-title">Wortzahl</h2>
        <p className="total" data-testid="total-words">
          <strong>{formatCount(total)}</strong> {total === 1 ? 'Wort' : 'Wörter'} gesamt
          {counted < pages.length && (
            <span className="hint">
              {' '}
              (aus {counted} von {pages.length} Seiten)
            </span>
          )}
        </p>
        <button type="button" disabled={counted === 0} onClick={copy}>
          Ergebnis kopieren
        </button>
        <span role="status">{copyMessage}</span>
      </div>

      <ol className="result-list">
        {rows.map((row) => {
          const page = pages[row.position - 1];
          const entry = state.entries[row.id];
          if (page === undefined || entry === undefined) return null;
          return (
            <ResultCard
              key={row.id}
              page={page}
              row={row}
              entry={entry}
              canRetry={canRetry}
              onEdit={(text) => runner.edit(row.id, text)}
              onRetry={() => runner.retry(row.id)}
            />
          );
        })}
      </ol>
    </section>
  );
}
