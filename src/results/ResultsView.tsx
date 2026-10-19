import { useEffect, useRef, useState } from 'react';
import { rotatedSize, type ImportPage } from '../import/pages.ts';
import { isOutdated } from '../pipeline/runner.ts';
import { describeError } from '../pipeline/transcriber.ts';
import { buildRows, formatSummary, totalWords, wordsText } from './summary.ts';
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

export function ResultsView({ pages, count, canRetry }: ResultsViewProps) {
  const { runner, state } = count;
  const [copyMessage, setCopyMessage] = useState('');
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const rows = buildRows(pages, state.entries);
  if (rows.length === 0) return null;

  const finished = rows.filter((row) => row.status === 'done');
  const total = totalWords(rows);

  const copy = () => {
    navigator.clipboard.writeText(formatSummary(rows)).then(
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
          <strong>{total}</strong> {total === 1 ? 'Wort' : 'Wörter'} gesamt
          {finished.length < rows.length && (
            <span className="hint">
              {' '}
              (aus {finished.length} von {rows.length} Seiten)
            </span>
          )}
        </p>
        <button type="button" disabled={finished.length === 0} onClick={copy}>
          Ergebnis kopieren
        </button>
        <span role="status">{copyMessage}</span>
      </div>

      <ol className="result-list">
        {rows.map((row) => {
          const page = pages[row.position - 1];
          const entry = state.entries[row.id];
          if (page === undefined || entry === undefined) return null;
          const outdated = isOutdated(entry, page);
          const lineCount = entry.text.split('\n').length;
          return (
            <li key={row.id} className="result-card" data-status={row.status}>
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
                {row.status === 'done' && (
                  <textarea
                    aria-label={`Transkript von Seite ${row.position}`}
                    value={entry.text}
                    rows={Math.min(Math.max(lineCount + 1, 4), 16)}
                    spellCheck={false}
                    onChange={(event) => runner.edit(row.id, event.target.value)}
                  />
                )}
                {row.status === 'error' && entry.error !== null && (
                  <p className="error-text" role="alert">
                    {describeError(entry.error)}
                  </p>
                )}
                {outdated && (
                  <p className="hint">
                    Die Seite wurde nach der Erkennung gedreht. Das Transkript passt vielleicht
                    nicht mehr.
                  </p>
                )}
                {(row.status === 'error' || outdated) && (
                  <button type="button" disabled={!canRetry} onClick={() => runner.retry(row.id)}>
                    {row.status === 'error' ? 'Erneut versuchen' : 'Neu erkennen'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
