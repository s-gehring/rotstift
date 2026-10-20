import { useMemo, useState } from 'react';
import { useProfileChoice } from './correction/ProfilePicker.tsx';
import { useCorrector } from './correction/use-corrector.ts';
import { CorrectorManagement, CorrectorSetupDialog } from './models/corrector-setup.tsx';
import { flattenPages } from './import/arbeiten.ts';
import { ImportView } from './import/ImportView.tsx';
import { useImportPages } from './import/use-import-pages.ts';
import { ModelManagement } from './models/ModelManagement.tsx';
import { ModelSetupDialog } from './models/ModelSetupDialog.tsx';
import { useModelSetup } from './models/use-model-setup.ts';
import { browserModelClient } from './pipeline/environment.ts';
import { isSwitchLocked } from './pipeline/runner.ts';
import { useEnginePhase } from './pipeline/use-engine-phase.ts';
import type { ModelAvailability } from './pipeline/provider.ts';
import { useTranscriber } from './pipeline/use-transcriber.ts';
import { CountControls, CountHint } from './results/CountControls.tsx';
import { ResultsView } from './results/ResultsView.tsx';
import { useWordCount } from './results/use-word-count.ts';
import { reviewBlocked, ReviewControls, ReviewHint } from './review/ReviewControls.tsx';
import { useMonitorPhase } from './review/engine-phase.ts';
import { ReviewView } from './review/ReviewView.tsx';
import { useReview } from './review/use-review.ts';

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
  const enginePhase = useEnginePhase(transcriber);
  const correction = useCorrector(modelClient);
  const corrector = correction.status;
  const correctorPhase = useMonitorPhase(
    corrector?.state === 'ready' ? corrector.engine : undefined,
  );
  const { profile, select: selectProfile } = useProfileChoice();
  const pages = useMemo(() => flattenPages(importState.arbeiten), [importState.arbeiten]);
  const review = useReview(count.runner, pages, corrector);
  const reviewing = review.state.run !== null;
  const [view, setView] = useState<'import' | 'review'>('import');
  const switchLocked = isSwitchLocked(count.state, enginePhase) || reviewing;
  const openSetup = () => {
    setDialogOpen(true);
  };
  const startReview = () => {
    setView('review');
    void review.flow.start(pages, profile);
  };

  return (
    <main className="app">
      <h1>Rotstift</h1>
      <p className="hint">Schülerarbeiten lokal korrigieren.</p>
      {view === 'review' ? (
        <ReviewView
          arbeiten={importState.arbeiten}
          flow={review.flow}
          state={review.state}
          entries={count.state.entries}
          canRetry={!reviewBlocked(transcriber, corrector)}
          preview={corrector?.state === 'ready' && corrector.preview}
          engine={{ transcriber: enginePhase, corrector: correctorPhase }}
          onBack={() => {
            setView('import');
          }}
        />
      ) : (
        <>
          <ImportView
            importState={importState}
            locked={reviewing}
            actions={
              <CountControls
                count={count}
                status={transcriber}
                arbeiten={importState.arbeiten}
                onSetup={openSetup}
                locked={reviewing}
              >
                <ReviewControls
                  state={review.state}
                  profile={profile}
                  onProfile={selectProfile}
                  transcriber={transcriber}
                  corrector={corrector}
                  pageCount={pages.length}
                  counting={count.state.batch !== null}
                  onStart={startReview}
                  onOpen={() => {
                    setView('review');
                  }}
                  onSetup={correction.setup.openSetup}
                />
              </CountControls>
            }
            footer={
              <>
                <CountHint
                  count={count}
                  status={transcriber}
                  arbeiten={importState.arbeiten}
                  download={setup.status}
                />
                <ReviewHint corrector={corrector} onSetup={correction.setup.openSetup} />
              </>
            }
          />
          <ResultsView
            arbeiten={importState.arbeiten}
            count={count}
            canRetry={transcriber?.state === 'ready'}
            locked={reviewing}
          />
        </>
      )}
      <ModelManagement setup={setup} onSetup={openSetup} disabled={switchLocked} />
      <CorrectorManagement corrector={correction.setup} disabled={reviewing} />
      {setup.available && (
        <ModelSetupDialog
          setup={setup}
          open={dialogOpen}
          switchDisabled={switchLocked}
          onClose={() => {
            setDialogOpen(false);
          }}
        />
      )}
      <CorrectorSetupDialog corrector={correction.setup} switchDisabled={reviewing} />
    </main>
  );
}
