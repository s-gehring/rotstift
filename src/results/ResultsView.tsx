import { useEffect, useMemo, useRef, useState } from 'react';
import {
  saveClassPdf,
  saveWordCountPdf,
  type SavePdfOptions,
  type SavePhase,
} from '../export/save-pdf.ts';
import type { SaveOutcome } from '../export/save-file.ts';
import { rotatedSize, type ImportPage } from '../import/pages.ts';
import { isCounting, isOutdated, type PageEntry } from '../pipeline/runner.ts';
import { describeError } from '../pipeline/transcriber.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import { CSV_FILE_NAME, formatClipboardTable, formatCsv, incompleteNote } from './export-table.ts';
import { createPdfInput } from './pdf-input.ts';
import { saveCsv } from './save-csv.ts';
import { saveMessage } from './save-message.ts';
import {
  arbeitenText,
  buildResults,
  classTotals,
  formatAverage,
  formatCount,
  pagesText,
  wordsText,
  type ArbeitResult,
  type ResultRow,
} from './summary.ts';
import type { WordCount } from './use-word-count.ts';

const STAGE = 144;
const CLASS_SCOPE = 'class';

interface PdfJob {
  readonly scope: string;
  readonly done: number;
  readonly total: number;
  readonly phase: SavePhase;
}

type PdfRunOptions = Required<
  Pick<SavePdfOptions, 'signal' | 'onProgress' | 'onPhase' | 'encodePage'>
>;

function PdfProgress({ job, onCancel }: { readonly job: PdfJob; readonly onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  if (job.phase === 'saving') {
    return (
      <span className="pdf-progress" role="status">
        Speicherort wählen …
      </span>
    );
  }
  const text = job.total === 0 ? 'PDF wird vorbereitet …' : `Seite ${job.done} von ${job.total}`;
  return (
    <span className="pdf-progress">
      <progress
        value={job.done}
        max={Math.max(job.total, 1)}
        aria-label="Fortschritt des PDF-Exports"
        aria-valuetext={text}
      />
      <span>{text}</span>
      <button type="button" ref={cancel} onClick={onCancel}>
        Abbrechen
      </button>
    </span>
  );
}

const STATUS_TEXT = {
  waiting: 'wartet',
  running: 'läuft …',
  done: 'fertig',
  error: 'Fehler',
} as const;

interface ResultsViewProps {
  readonly arbeiten: readonly Arbeit[];
  readonly count: WordCount;
  readonly canRetry: boolean;
  readonly locked?: boolean;
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
  readonly arbeitName: string;
  readonly onEdit: (text: string) => void;
  readonly onRetry: () => void;
}

function ResultCard({ page, row, entry, canRetry, arbeitName, onEdit, onRetry }: ResultCardProps) {
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
          <h4>
            Seite {row.position} <span className="page-label">{row.label}</span>
          </h4>
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
            aria-label={`Transkript von Seite ${row.position} (${arbeitName})`}
            value={entry.text}
            readOnly={entry.status !== 'done'}
            rows={Math.min(Math.max(entry.text.split('\n').length + 1, 4), 16)}
            spellCheck={false}
            onChange={(event) => onEdit(event.target.value)}
          />
        )}
        {entry.hasTranscript &&
          entry.status === 'done' &&
          entry.error === null &&
          !entry.edited &&
          entry.text.trim() === '' && (
            <p className="hint">Keine Schrift erkannt. Die Seite scheint leer zu sein.</p>
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

function ArbeitSection({
  arbeit,
  result,
  count,
  canRetry,
  pdfJob,
  pdfBlocked,
  onSavePdf,
  onCancelPdf,
}: {
  readonly arbeit: Arbeit;
  readonly result: ArbeitResult;
  readonly count: WordCount;
  readonly canRetry: boolean;
  readonly pdfJob: PdfJob | null;
  readonly pdfBlocked: boolean;
  readonly onSavePdf: (trigger: HTMLElement) => void;
  readonly onCancelPdf: () => void;
}) {
  const { runner, state } = count;
  const headingId = `arbeit-${arbeit.id}`;
  return (
    <li className="arbeit-result">
      <section aria-labelledby={headingId}>
        <div className="arbeit-result-head">
          <h3 id={headingId}>{result.name}</h3>
          <span className="hint">{pagesText(result.pageCount)}</span>
          <span className="words" data-testid="arbeit-words">
            {result.countedPages === 0 ? 'Nicht gezählt' : wordsText(result.words)}
          </span>
          {result.countedPages > 0 && result.countedPages < result.pageCount && (
            <span className="hint">
              (aus {result.countedPages} von {result.pageCount} Seiten)
            </span>
          )}
          <button
            type="button"
            aria-label={`Als PDF speichern: ${result.name}`}
            disabled={pdfBlocked || result.countedPages === 0}
            onClick={(event) => onSavePdf(event.currentTarget)}
          >
            Als PDF speichern
          </button>
          {pdfJob !== null && <PdfProgress job={pdfJob} onCancel={onCancelPdf} />}
        </div>
        <ol className="result-list">
          {result.rows.map((row) => {
            const page = arbeit.pages[row.position - 1];
            const entry = state.entries[row.id];
            if (page === undefined || entry === undefined) return null;
            return (
              <ResultCard
                key={row.id}
                page={page}
                row={row}
                entry={entry}
                canRetry={canRetry}
                arbeitName={result.name}
                onEdit={(text) => runner.edit(row.id, text)}
                onRetry={() => runner.retry(row.id)}
              />
            );
          })}
        </ol>
      </section>
    </li>
  );
}

export function ResultsView({ arbeiten, count, canRetry, locked = false }: ResultsViewProps) {
  const { state } = count;
  const [exportMessage, setExportMessage] = useState('');
  const [pdfJob, setPdfJob] = useState<PdfJob | null>(null);
  const messageTimer = useRef<number | undefined>(undefined);
  const pdfAbort = useRef<AbortController | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pdfInput = useMemo(() => createPdfInput(), []);
  useEffect(
    () => () => {
      window.clearTimeout(messageTimer.current);
      pdfAbort.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (pdfJob === null && returnFocus.current?.isConnected) returnFocus.current.focus();
    if (pdfJob === null) returnFocus.current = null;
  }, [pdfJob]);
  const results = buildResults(arbeiten, state.entries);
  if (results.every((result) => result.rows.length === 0)) return null;
  const totals = classTotals(results);
  const note = incompleteNote(results);

  const announce = (text: string) => {
    setExportMessage(text);
    window.clearTimeout(messageTimer.current);
    messageTimer.current = window.setTimeout(() => setExportMessage(''), 6000);
  };

  const copy = () => {
    navigator.clipboard.writeText(formatClipboardTable(results)).then(
      () => announce('In die Zwischenablage kopiert.'),
      () => announce('Kopieren war nicht möglich.'),
    );
  };

  const save = () => {
    void saveCsv(formatCsv(results), CSV_FILE_NAME).then((outcome) => {
      const message = saveMessage(outcome, 'csv');
      if (message !== null) announce(message);
    });
  };

  const pdfBlocked = pdfJob !== null || isCounting(state);

  const runPdf = (
    scope: string,
    trigger: HTMLElement,
    start: (options: PdfRunOptions) => Promise<SaveOutcome>,
  ) => {
    if (pdfAbort.current !== null) return;
    const abort = new AbortController();
    pdfAbort.current = abort;
    returnFocus.current = trigger;
    setPdfJob({ scope, done: 0, total: 0, phase: 'building' });
    void start({
      signal: abort.signal,
      encodePage: pdfInput.encodePage,
      onProgress: (done, total) => setPdfJob({ scope, done, total, phase: 'building' }),
      onPhase: (phase) => setPdfJob((job) => (job === null ? job : { ...job, phase })),
    }).then((outcome) => {
      pdfAbort.current = null;
      setPdfJob(null);
      const aborted = abort.signal.aborted && outcome.state === 'cancelled';
      const message = aborted ? 'Das Speichern wurde abgebrochen.' : saveMessage(outcome, 'pdf');
      if (message !== null) announce(message);
    });
  };

  const cancelPdf = () => pdfAbort.current?.abort();

  const saveArbeitPdf = (arbeit: Arbeit, result: ArbeitResult, trigger: HTMLElement) =>
    runPdf(arbeit.id, trigger, (options) =>
      saveWordCountPdf(pdfInput.wordCountArbeit(arbeit, result), options),
    );

  const saveClassPdfFile = (trigger: HTMLElement) =>
    runPdf(CLASS_SCOPE, trigger, (options) =>
      saveClassPdf(
        results.flatMap((result) => {
          const arbeit = arbeiten.find((candidate) => candidate.id === result.id);
          return arbeit === undefined || result.rows.length === 0
            ? []
            : [{ kind: 'wordCount' as const, ...pdfInput.wordCountArbeit(arbeit, result) }];
        }),
        options,
      ),
    );

  return (
    <section className="results" aria-labelledby="results-title">
      <fieldset className="lock-area" disabled={locked}>
        {locked && (
          <p className="hint">
            Während der Berichtigung lassen sich Wortzahlen nicht ändern oder speichern.
          </p>
        )}
        <div className="results-header">
          <h2 id="results-title" tabIndex={-1}>
            Wortzahl
          </h2>
          <p className="total" data-testid="total-words">
            <strong>{formatCount(totals.words)}</strong> {totals.words === 1 ? 'Wort' : 'Wörter'}{' '}
            gesamt
            {totals.countedPages < totals.pages && (
              <span className="hint">
                {' '}
                (aus {totals.countedPages} von {totals.pages} Seiten)
              </span>
            )}
          </p>
          <p className="average" data-testid="average-words">
            {arbeitenText(totals.arbeiten)}
            {totals.average !== null && (
              <>
                {' · '}Durchschnitt <strong>{formatAverage(totals.average)}</strong> Wörter pro
                Arbeit
                {totals.completeArbeiten < totals.arbeiten && (
                  <span className="hint">
                    {' '}
                    (aus {totals.completeArbeiten} von {totals.arbeiten} Arbeiten)
                  </span>
                )}
              </>
            )}
          </p>
          <div className="export-actions">
            <button type="button" disabled={totals.countedPages === 0} onClick={save}>
              Als CSV speichern
            </button>
            <button type="button" disabled={totals.countedPages === 0} onClick={copy}>
              In die Zwischenablage kopieren
            </button>
            <button
              type="button"
              disabled={pdfBlocked || totals.countedPages === 0}
              onClick={(event) => saveClassPdfFile(event.currentTarget)}
            >
              Klassen-PDF speichern
            </button>
            {pdfJob?.scope === CLASS_SCOPE && <PdfProgress job={pdfJob} onCancel={cancelPdf} />}
            <span role="status">{exportMessage}</span>
          </div>
          {note !== null && <p className="hint">{note}</p>}
        </div>
        <ul className="arbeit-results">
          {arbeiten.map((arbeit) => {
            const result = results.find((candidate) => candidate.id === arbeit.id);
            if (result === undefined || result.rows.length === 0) return null;
            return (
              <ArbeitSection
                key={arbeit.id}
                arbeit={arbeit}
                result={result}
                count={count}
                canRetry={canRetry}
                pdfJob={pdfJob?.scope === arbeit.id ? pdfJob : null}
                pdfBlocked={pdfBlocked}
                onSavePdf={(trigger) => saveArbeitPdf(arbeit, result, trigger)}
                onCancelPdf={cancelPdf}
              />
            );
          })}
        </ul>
      </fieldset>
    </section>
  );
}
