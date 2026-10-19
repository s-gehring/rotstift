import { useMemo, useState } from 'react';
import { ImportView } from './import/ImportView.tsx';
import { useImportPages } from './import/use-import-pages.ts';
import { ModelManagement } from './models/ModelManagement.tsx';
import { ModelSetupDialog } from './models/ModelSetupDialog.tsx';
import { useModelSetup } from './models/use-model-setup.ts';
import { browserModelClient } from './pipeline/environment.ts';
import type { ModelAvailability } from './pipeline/provider.ts';
import { useTranscriber } from './pipeline/use-transcriber.ts';
import { CountControls, CountHint } from './results/CountControls.tsx';
import { ResultsView } from './results/ResultsView.tsx';
import { useWordCount } from './results/use-word-count.ts';

const modelClient = browserModelClient();

export function App() {
  const importState = useImportPages();
  const setup = useModelSetup(modelClient);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { model } = setup;
  const modelState = setup.status?.state;
  const availability = useMemo<ModelAvailability | null>(
    () => (modelState === undefined ? null : { model, state: modelState }),
    [model, modelState],
  );
  const transcriber = useTranscriber(availability, () => {
    void setup.refresh();
  });
  const count = useWordCount(importState.pages, transcriber);
  const openSetup = () => {
    setDialogOpen(true);
  };

  return (
    <main className="app">
      <h1>Rotstift</h1>
      <p className="hint">Schülerarbeiten lokal korrigieren.</p>
      <ImportView
        importState={importState}
        actions={
          <CountControls
            count={count}
            status={transcriber}
            pages={importState.pages}
            onSetup={openSetup}
          />
        }
        footer={
          <CountHint
            count={count}
            status={transcriber}
            pages={importState.pages}
            download={setup.status}
          />
        }
      />
      <ResultsView
        pages={importState.pages}
        count={count}
        canRetry={transcriber?.state === 'ready'}
      />
      <ModelManagement setup={setup} onSetup={openSetup} disabled={count.state.batch !== null} />
      {setup.available && (
        <ModelSetupDialog
          setup={setup}
          open={dialogOpen}
          onClose={() => {
            setDialogOpen(false);
          }}
        />
      )}
    </main>
  );
}
