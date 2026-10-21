import { findErrorKind } from '../annotations/catalog.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';
import { useApp } from '../app/app-context.tsx';
import { formatAverage, formatCount } from '../results/summary.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { buildOverview, type Overview, type OverviewTag } from './overview.ts';
import { formatRate, type TypeCount } from './summary.ts';
import './review.css';

function typeName(profile: CorrectionProfile, code: string): string {
  return findErrorKind(profile.language, code)?.name ?? code;
}

function count(value: number | null): string {
  return value === null ? '–' : formatCount(value);
}

function Tag({ tag }: { readonly tag: OverviewTag }) {
  return (
    <span className="overview-tag" title={tag.title} aria-label={tag.title}>
      {tag.text}
    </span>
  );
}

function TopTypes({
  types,
  profile,
}: {
  readonly types: readonly TypeCount[];
  readonly profile: CorrectionProfile;
}) {
  if (types.length === 0) return <>–</>;
  return (
    <span className="overview-top">
      {types.map(({ type, count: amount }) => (
        <span key={type}>
          <abbr title={typeName(profile, type)}>{type}</abbr> {formatCount(amount)}
        </span>
      ))}
    </span>
  );
}

function TypeBars({
  types,
  profile,
}: {
  readonly types: readonly TypeCount[];
  readonly profile: CorrectionProfile;
}) {
  const most = types[0]?.count ?? 0;
  return (
    <section className="overview-section" aria-labelledby="overview-types">
      <h3 id="overview-types">Fehlerarten</h3>
      {types.length === 0 ? (
        <p className="overview-empty">Keine Fehler</p>
      ) : (
        <ul className="overview-types">
          {types.map(({ type, count: amount }) => (
            <li key={type}>
              <span className="overview-type-code">{type}</span>
              <span className="overview-type-name">{typeName(profile, type)}</span>
              <span className="overview-type-bar" aria-hidden="true">
                <span style={{ width: `${(amount / Math.max(most, 1)) * 100}%` }} />
              </span>
              <span className="overview-type-count">{formatCount(amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OverviewTable({
  overview,
  profile,
  onOpen,
}: {
  readonly overview: Overview;
  readonly profile: CorrectionProfile | null;
  readonly onOpen: (id: string) => void;
}) {
  const { corrected, rows, total } = overview;
  const full = corrected && profile !== null;
  return (
    <table className="overview-table">
      <thead>
        <tr>
          <th scope="col">Arbeit</th>
          <th scope="col" className="num">
            Wörter
          </th>
          {full && (
            <>
              <th scope="col" className="num">
                Fehler
              </th>
              <th scope="col" className="num">
                je 100 Wörter
              </th>
              <th scope="col">Häufigste Fehler</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <th scope="row">
              <button type="button" className="overview-name" onClick={() => onOpen(row.id)}>
                {row.name}
              </button>
              {row.tag !== null && <Tag tag={row.tag} />}
            </th>
            <td className="num">{count(row.words)}</td>
            {full && (
              <>
                <td className="num">{count(row.errors)}</td>
                <td className="num">{row.rate === null ? '–' : formatRate(row.rate)}</td>
                <td>
                  <TopTypes types={row.top} profile={profile} />
                </td>
              </>
            )}
          </tr>
        ))}
      </tbody>
      {total !== null && (
        <tfoot>
          <tr>
            <th scope="row">Klasse</th>
            <td className="num">{formatCount(total.words)}</td>
            {full && (
              <>
                <td className="num">{count(total.errors)}</td>
                <td className="num">{total.rate === null ? '–' : formatRate(total.rate)}</td>
                <td>
                  <TopTypes types={overview.types.slice(0, 3)} profile={profile} />
                </td>
              </>
            )}
          </tr>
          {!full && total.average !== null && (
            <tr>
              <th scope="row">Durchschnitt</th>
              <td className="num">{formatAverage(total.average)}</td>
            </tr>
          )}
        </tfoot>
      )}
    </table>
  );
}

export function ClassOverviewDialog() {
  const { navigation, work, importState } = useApp();
  const review = work.review.state;
  const profile = review.profile;
  const overview = buildOverview(
    importState.arbeiten,
    review,
    work.count.state.entries,
    profile?.allowedTypes ?? [],
  );
  return (
    <Dialog
      open={navigation.overviewOpen}
      onClose={navigation.closeOverview}
      title="Übersicht"
      size="lg"
    >
      <div className="overview">
        <OverviewTable overview={overview} profile={profile} onOpen={navigation.openArbeit} />
        {overview.corrected && profile !== null && overview.total !== null && (
          <TypeBars types={overview.types} profile={profile} />
        )}
      </div>
    </Dialog>
  );
}
