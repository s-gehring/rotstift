import { useId, useState } from 'react';
import { findErrorKind } from '../annotations/catalog.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';
import { listErrors, type AnnotatedError } from '../annotations/transcript.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import { AnnotatedPage } from '../overlay/AnnotatedPage.tsx';
import { formatCount, pagesText, wordsText } from '../results/summary.ts';
import type { Statistics } from '../stats/statistics.ts';
import type { ReviewFlow, ReviewPage, ReviewState, ReviewStatus } from './review-flow.ts';
import { PREVIEW_NOTICE } from './ReviewControls.tsx';
import {
  errorsText,
  formatRate,
  sortedTypes,
  summarizeArbeit,
  summarizeClass,
  type ArbeitReview,
} from './summary.ts';
import './review.css';

type Display = 'notes' | 'original';

interface ReviewViewProps {
  readonly arbeiten: readonly Arbeit[];
  readonly flow: ReviewFlow;
  readonly state: ReviewState;
  readonly canRetry: boolean;
  readonly preview: boolean;
  readonly onBack: () => void;
}

const STATUS_TEXT: Readonly<Record<ReviewStatus, string>> = {
  waiting: 'wartet',
  transcribing: 'Texterkennung läuft …',
  locating: 'Zeilen werden gesucht …',
  correcting: 'Korrektur läuft …',
  done: 'berichtigt',
  empty: 'Keine Schrift erkannt, nicht berichtigt',
  unreadable: 'Nicht erkannt, nicht berichtigt',
  failed: 'Korrektur fehlgeschlagen',
  cancelled: 'Abgebrochen, nicht berichtigt',
};

const PHASE_TEXT = {
  transcribing: 'Texterkennung',
  locating: 'Zeilen suchen',
  correcting: 'Korrektur',
} as const;

const RETRYABLE: ReadonlySet<ReviewStatus> = new Set(['unreadable', 'failed', 'cancelled']);

function progressText(state: ReviewState, arbeiten: readonly Arbeit[]): string {
  const { run } = state;
  if (run !== null) {
    const label = PHASE_TEXT[run.phase];
    if (run.total === 0) return `${label} …`;
    return `${label}: Seite ${Math.min(run.finished + 1, run.total)} von ${run.total}`;
  }
  if (state.outcome === 'cancelled') return 'Abgebrochen.';
  if (state.outcome === 'finished') {
    const summary = summarizeClass(arbeiten, state);
    const pages = summary.arbeiten.reduce((sum, arbeit) => sum + arbeit.pageCount, 0);
    const corrected = summary.arbeiten.reduce((sum, arbeit) => sum + arbeit.corrected, 0);
    const problems = summary.arbeiten.reduce((sum, arbeit) => sum + arbeit.problems, 0);
    const parts = [`Fertig: ${corrected} von ${pagesText(pages)} berichtigt.`];
    if (problems > 0) parts.push(`${pagesText(problems)} mit Problemen.`);
    return parts.join(' ');
  }
  return '';
}

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

function ClassOverview({
  arbeiten,
  state,
  profile,
  selected,
  onSelect,
}: {
  readonly arbeiten: readonly Arbeit[];
  readonly state: ReviewState;
  readonly profile: CorrectionProfile;
  readonly selected: string | undefined;
  readonly onSelect: (id: string) => void;
}) {
  const summary = summarizeClass(arbeiten, state);
  const total = summary.statistics;
  return (
    <section className="class-overview" aria-labelledby="class-overview-title">
      <h3 id="class-overview-title">Klassenübersicht</h3>
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
            <tr key={arbeit.id} aria-current={arbeit.id === selected ? 'true' : undefined}>
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
              <td>{summary.reviewed === 1 ? '1 Arbeit' : `${summary.reviewed} Arbeiten`}</td>
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
  const parts = [`${arbeit.corrected} von ${arbeit.pageCount} berichtigt`];
  if (arbeit.empty > 0) parts.push(`${arbeit.empty} leer`);
  if (arbeit.problems > 0) parts.push(`${arbeit.problems} mit Problem`);
  return parts.join(', ');
}

function markText(error: AnnotatedError): string {
  if (error.kind === 'omission') return `fehlt: „${error.correction}“`;
  if (error.correction === '') return `„${error.original}“ streichen`;
  return `„${error.original}“ → „${error.correction}“`;
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
  profile,
  display,
  arbeitName,
  canRetry,
  onRetry,
}: {
  readonly page: ImportPage;
  readonly position: number;
  readonly review: ReviewPage | undefined;
  readonly profile: CorrectionProfile;
  readonly display: Display;
  readonly arbeitName: string;
  readonly canRetry: boolean;
  readonly onRetry: () => void;
}) {
  const status = review?.status ?? 'waiting';
  const image = review?.image ?? null;
  const result = review?.result ?? null;
  const headingId = useId();
  const alt = `Seite ${position} von ${arbeitName}`;
  return (
    <li className="review-page" data-status={status}>
      <section aria-labelledby={headingId}>
        <div className="review-page-head">
          <h4 id={headingId}>Seite {position}</h4>
          <span className="status" data-status={status}>
            {status === 'done' && result
              ? errorsText(result.statistics.errors)
              : STATUS_TEXT[status]}
          </span>
          {canRetry && RETRYABLE.has(status) && (
            <button type="button" onClick={onRetry}>
              Seite {position} erneut berichtigen
            </button>
          )}
        </div>
        {review?.message && <p className="error-text">{review.message}</p>}
        {review?.detail && <p className="hint">{review.detail}</p>}
        <div className="review-page-body">
          <div className="review-stage">
            {image !== null && result !== null && display === 'notes' ? (
              <AnnotatedPage
                imageUrl={image.url}
                size={{ width: image.width, height: image.height }}
                transcript={result.transcript}
                profile={profile}
                alt={`${alt}, mit Korrekturen`}
              />
            ) : (
              <img src={image?.url ?? page.thumbnailUrl} alt={alt} />
            )}
          </div>
          <div className="review-page-info">
            {result !== null && result.unplacedLines.length > 0 && (
              <p className="notice warn">
                {result.unplacedLines.length === 1
                  ? `Zeile ${result.unplacedLines[0]} wurde auf der Seite nicht gefunden. Ihre Fehler stehen nur in der Liste.`
                  : `Die Zeilen ${result.unplacedLines.join(', ')} wurden auf der Seite nicht gefunden. Ihre Fehler stehen nur in der Liste.`}
              </p>
            )}
            {review !== undefined && <MarkList page={review} profile={profile} />}
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
  profile,
  canRetry,
}: {
  readonly arbeit: Arbeit;
  readonly flow: ReviewFlow;
  readonly state: ReviewState;
  readonly profile: CorrectionProfile;
  readonly canRetry: boolean;
}) {
  const [display, setDisplay] = useState<Display>('notes');
  const summary = summarizeArbeit(arbeit, state);
  const statistics = summary.statistics;
  const toggleName = useId();
  const running = state.run !== null;
  return (
    <section className="arbeit-review" aria-labelledby="arbeit-review-title">
      <div className="arbeit-review-head">
        <h3 id="arbeit-review-title">{arbeit.name}</h3>
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
            {summary.corrected < summary.pageCount && (
              <span className="hint">
                {' '}
                (aus {summary.corrected} von {pagesText(summary.pageCount)})
              </span>
            )}
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
            profile={profile}
            display={display}
            arbeitName={arbeit.name}
            canRetry={canRetry && !running}
            onRetry={() => void flow.retry(page)}
          />
        ))}
      </ol>
    </section>
  );
}

export function ReviewView({ arbeiten, flow, state, canRetry, preview, onBack }: ReviewViewProps) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const profile = state.profile;
  const reviewed = arbeiten.filter((arbeit) =>
    arbeit.pages.some((page) => state.pages[page.id] !== undefined),
  );
  const current = reviewed.find((arbeit) => arbeit.id === selected) ?? reviewed[0];
  const running = state.run !== null;

  return (
    <section className="review" aria-labelledby="review-title">
      <div className="review-header">
        <button type="button" onClick={onBack}>
          Zurück zu den Arbeiten
        </button>
        <h2 id="review-title">Berichtigung</h2>
        {profile !== null && <span className="hint">Korrekturprofil {profile.name}</span>}
        {running && (
          <button type="button" className="primary" onClick={flow.cancel}>
            Abbrechen
          </button>
        )}
        <p className="progress" role="status">
          {progressText(state, arbeiten)}
        </p>
      </div>
      {preview && <p className="notice demo">{PREVIEW_NOTICE}</p>}
      {profile === null || current === undefined ? (
        <p className="hint">Noch nichts berichtigt.</p>
      ) : (
        <>
          <ClassOverview
            arbeiten={reviewed}
            state={state}
            profile={profile}
            selected={current.id}
            onSelect={setSelected}
          />
          <ArbeitDetail
            key={current.id}
            arbeit={current}
            flow={flow}
            state={state}
            profile={profile}
            canRetry={canRetry}
          />
        </>
      )}
    </section>
  );
}
