import { useId, useMemo, useState } from 'react';
import { findErrorKind } from '../annotations/catalog.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';
import { listErrors } from '../annotations/transcript.ts';
import { nextHintStatus, openHints, type HintStatus } from '../correction/uncertain-reading.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import { saveClassPdf, saveCorrectedPdf } from '../export/save-pdf.ts';
import { AnnotatedPage } from '../overlay/AnnotatedPage.tsx';
import { markText } from '../overlay/hint-layout.ts';
import { formatCount, wordsText } from '../results/summary.ts';
import type { Statistics } from '../stats/statistics.ts';
import {
  arbeitExportBlock,
  createReviewExport,
  EXPORT_BLOCK_TEXT,
  PDF_FOOTER,
  type ReviewExport,
} from './export-input.ts';
import { useObjectUrl } from './page-image.ts';
import type {
  CorrectedPage,
  ReviewFlow,
  ReviewPage,
  ReviewState,
  ReviewStatus,
} from './review-flow.ts';
import { PdfControls, usePdfSave, type PdfSave } from './ReviewPdf.tsx';
import {
  errorsText,
  formatRate,
  hintsText,
  incompleteText,
  pageCondition,
  sortedTypes,
  summarizeArbeit,
  summarizeClass,
  type ArbeitReview,
  type Entries,
} from './summary.ts';
import './review.css';

type Display = 'notes' | 'original';

interface ReviewViewProps {
  readonly arbeiten: readonly Arbeit[];
  readonly arbeitId: string;
  readonly flow: ReviewFlow;
  readonly state: ReviewState;
  readonly entries: Entries;
  readonly canRetry: boolean;
}

const STATUS_TEXT: Readonly<Record<ReviewStatus, string>> = {
  waiting: 'wartet',
  transcribing: 'Texterkennung läuft …',
  locating: 'Zeilen werden gesucht …',
  correcting: 'Korrektur läuft …',
  done: 'berichtigt',
  empty: 'Keine Schrift erkannt, nicht berichtigt',
  unreadable: 'Problem: Nicht erkannt, nicht berichtigt',
  failed: 'Problem: Korrektur fehlgeschlagen',
  cancelled: 'Problem: Abgebrochen, nicht berichtigt',
};

const STALE_TEXT = 'Veraltet: Nach Drehen oder Bearbeiten bitte erneut berichtigen';

const CLASS_SCOPE = 'class';

const RETRYABLE: ReadonlySet<ReviewStatus> = new Set(['unreadable', 'failed', 'cancelled']);

function typeName(profile: CorrectionProfile, code: string): string {
  return findErrorKind(profile.language, code)?.name ?? code;
}

function TypeList({
  statistics,
  profile,
}: {
  readonly statistics: Statistics;
  readonly profile: CorrectionProfile;
}) {
  const types = sortedTypes(statistics, profile.allowedTypes);
  if (types.length === 0) return <p className="hint">Keine Fehler markiert.</p>;
  return (
    <ul className="type-list">
      {types.map(({ type, count }) => (
        <li key={type}>
          <abbr title={typeName(profile, type)}>{type}</abbr> {typeName(profile, type)}:{' '}
          <strong>{formatCount(count)}</strong>
        </li>
      ))}
    </ul>
  );
}

function topTypes(statistics: Statistics, profile: CorrectionProfile): string {
  const types = sortedTypes(statistics, profile.allowedTypes).slice(0, 3);
  return types.length === 0 ? 'keine' : types.map((t) => `${t.type} (${t.count})`).join(', ');
}

export function ClassOverview({
  arbeiten,
  state,
  entries,
  profile,
  selected,
  onSelect,
  pdf,
  exporter,
}: {
  readonly arbeiten: readonly Arbeit[];
  readonly state: ReviewState;
  readonly entries: Entries;
  readonly profile: CorrectionProfile;
  readonly selected: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly pdf: PdfSave;
  readonly exporter: ReviewExport;
}) {
  const summary = summarizeClass(arbeiten, state, entries);
  const total = summary.statistics;
  const included = exporter.classArbeiten(arbeiten, state, entries, profile);
  const left = arbeiten.length - included.length;
  let blocked: string | null = null;
  if (state.run !== null) blocked = EXPORT_BLOCK_TEXT.running;
  else if (summary.arbeiten.some((arbeit) => arbeit.preview)) blocked = EXPORT_BLOCK_TEXT.preview;
  else if (included.length === 0) blocked = 'Noch keine Arbeit ist vollständig berichtigt.';
  return (
    <section className="class-overview" aria-labelledby="class-overview-title">
      <div className="class-overview-head">
        <h3 id="class-overview-title">Klassenübersicht</h3>
        <PdfControls
          scope={CLASS_SCOPE}
          label="Klassen-PDF speichern"
          accessibleLabel="Klassen-PDF mit Korrekturen speichern"
          pdf={pdf}
          blocked={blocked}
          onSave={(trigger) => {
            pdf.run(CLASS_SCOPE, trigger, (options) =>
              saveClassPdf(included, {
                ...options,
                encodePage: exporter.encodePage,
                footer: PDF_FOOTER,
              }),
            );
          }}
        />
      </div>
      {blocked === null && left > 0 && (
        <p className="hint">
          {left === 1
            ? '1 Arbeit ist nicht vollständig berichtigt und fehlt im Klassen-PDF.'
            : `${left} Arbeiten sind nicht vollständig berichtigt und fehlen im Klassen-PDF.`}
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th scope="col">Arbeit</th>
            <th scope="col">Seiten</th>
            <th scope="col">Wörter</th>
            <th scope="col">Fehler</th>
            <th scope="col">Fehler je 100 Wörter</th>
            <th scope="col">Häufigste Fehler</th>
          </tr>
        </thead>
        <tbody>
          {summary.arbeiten.map((arbeit) => (
            <tr
              key={arbeit.id}
              aria-current={arbeit.id === selected ? 'true' : undefined}
              data-complete={arbeit.complete}
            >
              <th scope="row">
                <button
                  type="button"
                  className="link"
                  aria-pressed={arbeit.id === selected}
                  onClick={() => onSelect(arbeit.id)}
                >
                  {arbeit.name}
                </button>
              </th>
              <td>{pagesCell(arbeit)}</td>
              <td>{arbeit.statistics ? formatCount(arbeit.statistics.words) : '–'}</td>
              <td>{arbeit.statistics ? formatCount(arbeit.statistics.errors) : '–'}</td>
              <td>{arbeit.statistics ? formatRate(arbeit.statistics.errorsPer100Words) : '–'}</td>
              <td>{arbeit.statistics ? topTypes(arbeit.statistics, profile) : '–'}</td>
            </tr>
          ))}
        </tbody>
        {total !== null && (
          <tfoot>
            <tr>
              <th scope="row">Klasse gesamt</th>
              <td>
                {summary.reviewed === 1 ? '1 Arbeit' : `${summary.reviewed} Arbeiten`}
                {summary.incomplete > 0 && `, davon ${summary.incomplete} unvollständig`}
              </td>
              <td>{formatCount(total.words)}</td>
              <td>{formatCount(total.errors)}</td>
              <td>{formatRate(total.errorsPer100Words)}</td>
              <td>{topTypes(total, profile)}</td>
            </tr>
          </tfoot>
        )}
      </table>
      {total !== null && (
        <div className="class-types">
          <h4>Fehlertypen in der Klasse</h4>
          <TypeList statistics={total} profile={profile} />
        </div>
      )}
    </section>
  );
}

function pagesCell(arbeit: ArbeitReview): string {
  const head = arbeit.complete
    ? `${arbeit.pageCount} von ${arbeit.pageCount} berichtigt`
    : incompleteText(arbeit);
  const parts = [head];
  if (arbeit.empty > 0) parts.push(`${arbeit.empty} leer`);
  if (arbeit.problems > 0) parts.push(`${arbeit.problems} mit Problem`);
  if (arbeit.stale > 0) parts.push(`${arbeit.stale} veraltet`);
  return parts.join(', ');
}

const HINT_STATE: Readonly<Record<HintStatus, string>> = {
  open: 'unsicher gelesen',
  accepted: 'als Fehler übernommen',
  dismissed: 'verworfen',
};

const HINT_ACTION: Readonly<Record<HintStatus, string>> = {
  open: 'Als Fehler übernehmen',
  accepted: 'Verwerfen',
  dismissed: 'Wiederherstellen',
};

function HintList({
  result,
  onHint,
}: {
  readonly result: CorrectedPage;
  readonly onHint: (index: number, status: HintStatus) => void;
}) {
  if (result.hints.length === 0) return null;
  const open = openHints(result.hints);
  return (
    <details className="hint-list">
      <summary>
        {hintsText(result.hints.length)}
        {open < result.hints.length && `, ${formatCount(open)} offen`}
      </summary>
      <p className="hint">
        Hier war sich die Texterkennung unsicher, die Änderung beruht vielleicht nur auf einem
        Lesefehler. Diese Stellen zählen nicht als Fehler, bis Sie sie übernehmen.
      </p>
      <ol aria-label="Unsicher gelesene Stellen">
        {result.hints.map((hint, index) => (
          <li key={`${hint.line}-${hint.mark.offset}-${index}`} data-status={hint.status}>
            <span className="mark-line">Zeile {hint.line}</span>{' '}
            <span className="hint-text">{markText(hint.mark)}</span>{' '}
            <span className="hint-state">({HINT_STATE[hint.status]})</span>{' '}
            <button
              type="button"
              aria-label={`${HINT_ACTION[hint.status]}: Zeile ${hint.line}, ${markText(hint.mark)}`}
              onClick={() => onHint(index, nextHintStatus(hint.status))}
            >
              {HINT_ACTION[hint.status]}
            </button>
          </li>
        ))}
      </ol>
    </details>
  );
}

function MarkList({
  page,
  profile,
}: {
  readonly page: ReviewPage;
  readonly profile: CorrectionProfile;
}) {
  if (page.result === null) return null;
  const errors = listErrors(page.result.transcript);
  if (errors.length === 0)
    return <p className="hint">Auf dieser Seite wurde kein Fehler markiert.</p>;
  return (
    <ol className="mark-list" aria-label="Fehlerliste">
      {errors.map((error, index) => (
        <li key={`${error.line}-${error.offset}-${index}`}>
          <span className="mark-line">Zeile {error.line}</span>{' '}
          <abbr className="mark-code" title={typeName(profile, error.type)}>
            {error.type}
          </abbr>{' '}
          <span className="sr-only">({typeName(profile, error.type)})</span>
          {markText(error)}
        </li>
      ))}
    </ol>
  );
}

function PageReview({
  page,
  position,
  review,
  entries,
  profile,
  display,
  arbeitName,
  canRetry,
  onRetry,
  onHint,
}: {
  readonly page: ImportPage;
  readonly position: number;
  readonly review: ReviewPage | undefined;
  readonly entries: Entries;
  readonly profile: CorrectionProfile;
  readonly display: Display;
  readonly arbeitName: string;
  readonly canRetry: boolean;
  readonly onRetry: () => void;
  readonly onHint: (index: number, status: HintStatus) => void;
}) {
  const stale = pageCondition(page, review, entries) === 'stale';
  const status = review?.status ?? 'waiting';
  const image = stale ? null : (review?.image ?? null);
  const result = stale ? null : (review?.result ?? null);
  const imageUrl = useObjectUrl(image?.blob ?? null);
  const headingId = useId();
  const alt = `Seite ${position} von ${arbeitName}`;
  let statusText = STATUS_TEXT[status];
  const open = result === null ? 0 : openHints(result.hints);
  if (stale) statusText = STALE_TEXT;
  else if (status === 'done' && result) statusText = errorsText(result.statistics.errors);
  return (
    <li className="review-page" data-status={stale ? 'stale' : status}>
      <section aria-labelledby={headingId}>
        <div className="review-page-head">
          <h4 id={headingId}>Seite {position}</h4>
          <span className="status" data-status={stale ? 'stale' : status}>
            {statusText}
          </span>
          {open > 0 && <span className="status hint-count">{hintsText(open)}</span>}
          {canRetry && (stale || RETRYABLE.has(status)) && (
            <button type="button" onClick={onRetry}>
              Seite {position} erneut berichtigen
            </button>
          )}
        </div>
        {review?.message && <p className="error-text">{review.message}</p>}
        {review?.detail && <p className="hint">{review.detail}</p>}
        <div className="review-page-body">
          <div className="review-stage">
            {image !== null && imageUrl !== null && result !== null && display === 'notes' ? (
              <AnnotatedPage
                imageUrl={imageUrl}
                size={{ width: image.width, height: image.height }}
                transcript={result.transcript}
                profile={profile}
                alt={`${alt}, mit Korrekturen`}
                hints={result.hints}
                onToggleHint={(index) => {
                  const current = result.hints[index]?.status;
                  onHint(index, current === 'open' ? 'accepted' : 'open');
                }}
              />
            ) : (
              <img src={imageUrl ?? page.thumbnailUrl} alt={alt} />
            )}
          </div>
          <div className="review-page-info">
            {!stale && review?.warning && (
              <>
                <p className="notice warn">{review.warning.text}</p>
                <p className="hint">{review.warning.detail}</p>
              </>
            )}
            {!review?.warning && result !== null && result.unplacedLines.length > 0 && (
              <p className="notice warn">
                {result.unplacedLines.length === 1
                  ? `Zeile ${result.unplacedLines[0]} wurde auf der Seite nicht gefunden. Ihre Fehler stehen nur in der Liste.`
                  : `Die Zeilen ${result.unplacedLines.join(', ')} wurden auf der Seite nicht gefunden. Ihre Fehler stehen nur in der Liste.`}
              </p>
            )}
            {review !== undefined && !stale && <MarkList page={review} profile={profile} />}
            {result !== null && <HintList result={result} onHint={onHint} />}
          </div>
        </div>
      </section>
    </li>
  );
}

function ArbeitDetail({
  arbeit,
  flow,
  state,
  entries,
  profile,
  canRetry,
  pdf,
  exporter,
}: {
  readonly arbeit: Arbeit;
  readonly flow: ReviewFlow;
  readonly state: ReviewState;
  readonly entries: Entries;
  readonly profile: CorrectionProfile;
  readonly canRetry: boolean;
  readonly pdf: PdfSave;
  readonly exporter: ReviewExport;
}) {
  const block = arbeitExportBlock(arbeit, state, entries);
  const [display, setDisplay] = useState<Display>('notes');
  const summary = summarizeArbeit(arbeit, state, entries);
  const statistics = summary.statistics;
  const toggleName = useId();
  const running = state.run !== null;
  return (
    <section className="arbeit-review" aria-labelledby="arbeit-review-title">
      <div className="arbeit-review-head">
        <h3 id="arbeit-review-title">{arbeit.name}</h3>
        <PdfControls
          scope={arbeit.id}
          label="Als PDF speichern"
          accessibleLabel={`Als PDF speichern: ${arbeit.name}`}
          pdf={pdf}
          blocked={block === null ? null : EXPORT_BLOCK_TEXT[block]}
          onSave={(trigger) => {
            const corrected = exporter.correctedArbeit(arbeit, state, entries, profile);
            if (corrected === null) return;
            pdf.run(arbeit.id, trigger, (options) =>
              saveCorrectedPdf(corrected, {
                ...options,
                encodePage: exporter.encodePage,
                footer: PDF_FOOTER,
              }),
            );
          }}
        />
        <fieldset className="display-toggle">
          <legend>Darstellung</legend>
          <label>
            <input
              type="radio"
              name={toggleName}
              checked={display === 'notes'}
              onChange={() => setDisplay('notes')}
            />
            Mit Notizen
          </label>
          <label>
            <input
              type="radio"
              name={toggleName}
              checked={display === 'original'}
              onChange={() => setDisplay('original')}
            />
            Original
          </label>
        </fieldset>
      </div>
      {statistics !== null ? (
        <div className="arbeit-stats">
          <p>
            <strong>{wordsText(statistics.words)}</strong> ·{' '}
            <strong>{errorsText(statistics.errors)}</strong> ·{' '}
            {formatRate(statistics.errorsPer100Words)} Fehler je 100 Wörter
            {!summary.complete && <span className="hint"> ({incompleteText(summary)})</span>}
          </p>
          <TypeList statistics={statistics} profile={profile} />
        </div>
      ) : (
        <p className="hint">Noch keine Seite dieser Arbeit berichtigt.</p>
      )}
      <ol className="review-pages">
        {arbeit.pages.map((page, index) => (
          <PageReview
            key={page.id}
            page={page}
            position={index + 1}
            review={state.pages[page.id]}
            entries={entries}
            profile={profile}
            display={display}
            arbeitName={arbeit.name}
            canRetry={canRetry && !running}
            onRetry={() => void flow.retry(page)}
            onHint={(hint, status) => flow.setHint(page.id, hint, status)}
          />
        ))}
      </ol>
    </section>
  );
}

export function ReviewView({
  arbeiten,
  arbeitId,
  flow,
  state,
  entries,
  canRetry,
}: ReviewViewProps) {
  const profile = state.profile;
  const arbeit = arbeiten.find((candidate) => candidate.id === arbeitId);
  const pdf = usePdfSave();
  const exporter = useMemo(() => createReviewExport(), []);
  if (profile === null || arbeit === undefined) return null;
  return (
    <section className="review" aria-label="Korrektur">
      <ArbeitDetail
        key={arbeit.id}
        arbeit={arbeit}
        flow={flow}
        state={state}
        entries={entries}
        profile={profile}
        canRetry={canRetry}
        pdf={pdf}
        exporter={exporter}
      />
    </section>
  );
}
