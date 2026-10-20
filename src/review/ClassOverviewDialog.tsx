import { useMemo } from 'react';
import { useApp } from '../app/app-context.tsx';
import { buildResults, formatCount } from '../results/summary.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { createReviewExport } from './export-input.ts';
import { usePdfSave } from './ReviewPdf.tsx';
import { ClassOverview } from './ReviewView.tsx';

function WordCountTable() {
  const { importState, work, navigation } = useApp();
  const results = buildResults(importState.arbeiten, work.count.state.entries);
  return (
    <table className="word-count-table">
      <thead>
        <tr>
          <th scope="col">Arbeit</th>
          <th scope="col">Seiten</th>
          <th scope="col">Wörter</th>
        </tr>
      </thead>
      <tbody>
        {results.map((result) => (
          <tr key={result.id}>
            <th scope="row">
              <button
                type="button"
                className="link"
                onClick={() => navigation.openArbeit(result.id)}
              >
                {result.name}
              </button>
            </th>
            <td>{result.pageCount}</td>
            <td>{result.countedPages === 0 ? '–' : formatCount(result.words)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CorrectedOverview() {
  const { importState, work, navigation } = useApp();
  const pdf = usePdfSave();
  const exporter = useMemo(() => createReviewExport(), []);
  const { state } = work.review;
  if (state.profile === null) return null;
  const reviewed = importState.arbeiten.filter((arbeit) =>
    arbeit.pages.some((page) => state.pages[page.id] !== undefined),
  );
  return (
    <ClassOverview
      arbeiten={reviewed}
      state={state}
      entries={work.count.state.entries}
      profile={state.profile}
      selected={undefined}
      onSelect={navigation.openArbeit}
      pdf={pdf}
      exporter={exporter}
    />
  );
}

export function ClassOverviewDialog() {
  const { navigation, work } = useApp();
  const corrected = Object.keys(work.review.state.pages).length > 0;
  return (
    <Dialog
      open={navigation.overviewOpen}
      onClose={navigation.closeOverview}
      title="Übersicht"
      size="lg"
    >
      {corrected ? <CorrectedOverview /> : <WordCountTable />}
    </Dialog>
  );
}
