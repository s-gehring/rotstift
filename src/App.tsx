import { ImportView } from './import/ImportView.tsx';
import { useImportPages } from './import/use-import-pages.ts';
import { useTranscriber } from './pipeline/use-transcriber.ts';
import { CountControls, CountHint } from './results/CountControls.tsx';
import { ResultsView } from './results/ResultsView.tsx';
import { useWordCount } from './results/use-word-count.ts';

export function App() {
  const importState = useImportPages();
  const transcriber = useTranscriber();
  const count = useWordCount(importState.pages, transcriber);

  return (
    <main className="app">
      <h1>Rotstift</h1>
      <p className="hint">Schülerarbeiten lokal korrigieren.</p>
      <ImportView
        importState={importState}
        actions={<CountControls count={count} status={transcriber} pages={importState.pages} />}
        footer={<CountHint count={count} status={transcriber} pages={importState.pages} />}
      />
      <ResultsView
        pages={importState.pages}
        count={count}
        canRetry={transcriber?.state === 'ready'}
      />
    </main>
  );
}
