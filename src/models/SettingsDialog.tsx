import { useEffect, useRef, useState } from 'react';
import packageInfo from '../../package.json';
import { useApp } from '../app/app-context.tsx';
import type { ModelRole } from '../app/types.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { DiagnosticsLog } from './DiagnosticsLog.tsx';
import { describeDownloadError, formatSize } from './format.ts';
import { choiceModels, modelNote, totalBytes, type AnyModelInfo } from './registry.ts';
import { ROLE_NAME } from './role-text.ts';
import type { ModelState } from './types.ts';
import { hasRunningJob } from './setup-state.ts';
import type { ModelSetup } from './use-model-setup.ts';

const STATE_TEXT: Readonly<Record<ModelState, string>> = {
  ready: 'Bereit',
  missing: 'Nicht eingerichtet',
  downloading: 'Wird geladen',
  verifying: 'Wird geprüft',
  importing: 'Wird importiert',
  deleting: 'Wird gelöscht',
  unverified: 'Nicht geprüft',
  corrupt: 'Beschädigt',
};

const BUSY: ReadonlySet<ModelState> = new Set([
  'downloading',
  'verifying',
  'importing',
  'deleting',
]);

function ModelSection({
  role,
  setup,
  locked,
  onSetup,
}: {
  readonly role: ModelRole;
  readonly setup: ModelSetup<AnyModelInfo>;
  readonly locked: boolean;
  readonly onSetup: () => void;
}) {
  const [confirming, setConfirming] = useState<AnyModelInfo | null>(null);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming !== null) keep.current?.focus();
  }, [confirming]);
  const { model, status } = setup;
  const state = status?.state ?? null;
  const busy = state !== null && BUSY.has(state);
  const offered = choiceModels(setup.state.hardware?.totalRamBytes ?? null, model, setup.models);
  const choice = offered.length > 1;
  const rows = choice ? offered : [model];
  const headingId = `settings-${role}`;
  const switchDisabled = locked || hasRunningJob(setup.state);
  const confirmName = choice && confirming !== null ? confirming.displayName : ROLE_NAME[role];
  return (
    <section className="settings-section" aria-labelledby={headingId}>
      <h3 id={headingId}>{ROLE_NAME[role]}</h3>
      <fieldset className="model-choice" disabled={switchDisabled}>
        <legend className="visually-hidden">{ROLE_NAME[role]}</legend>
        {rows.map((candidate) => {
          const candidateState = setup.state.statuses[candidate.id]?.state ?? null;
          const candidateBusy = candidateState !== null && BUSY.has(candidateState);
          const hasFiles =
            candidateState === 'ready' ||
            candidateState === 'corrupt' ||
            (setup.state.statuses[candidate.id]?.downloadedBytes ?? 0) > 0;
          const note = modelNote(candidate);
          return (
            <div key={candidate.id} className="settings-model">
              <label className="settings-model-label">
                {choice && (
                  <input
                    type="radio"
                    name={`model-choice-${role}`}
                    checked={candidate.id === model.id}
                    onChange={() => void setup.select(candidate.id)}
                  />
                )}
                <span className="settings-model-text">
                  <span className="settings-model-line">
                    <span className="settings-model-name">{candidate.displayName}</span>
                    <span className="settings-model-size">{formatSize(totalBytes(candidate))}</span>
                    <span className="settings-model-state" data-state={candidateState ?? 'unknown'}>
                      {candidateState === null ? '' : STATE_TEXT[candidateState]}
                    </span>
                  </span>
                  {note !== null && <span className="settings-model-note">{note}</span>}
                </span>
              </label>
              {hasFiles && !candidateBusy && (
                <Button
                  variant="quiet"
                  className="is-danger"
                  disabled={locked}
                  onClick={() => setConfirming(candidate)}
                >
                  Löschen
                </Button>
              )}
            </div>
          );
        })}
      </fieldset>
      {setup.error !== null && (
        <p className="settings-error" role="alert">
          {describeDownloadError(setup.error)}
        </p>
      )}
      {setup.state.note !== null && <p className="settings-note">{setup.state.note}</p>}
      {confirming !== null ? (
        <div className="confirm" role="alertdialog" aria-label={`${confirmName} löschen`}>
          <p>{confirmName} wirklich löschen?</p>
          <Button
            variant="quiet"
            className="is-danger"
            onClick={() => {
              const target = confirming;
              setConfirming(null);
              void setup.remove(target.id);
            }}
          >
            Löschen
          </Button>
          <Button ref={keep} onClick={() => setConfirming(null)}>
            Behalten
          </Button>
        </div>
      ) : (
        <div className="settings-actions">
          {state === 'unverified' && (
            <Button onClick={() => void setup.verifyAgain()}>Erneut prüfen</Button>
          )}
          {state !== null && state !== 'ready' && !busy && (
            <>
              <Button onClick={onSetup}>Herunterladen</Button>
              <Button
                variant="quiet"
                disabled={setup.state.importing}
                onClick={() => void setup.importFiles()}
              >
                {setup.state.importing ? 'Wird importiert …' : 'Modell aus Datei importieren …'}
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function SettingsDialog() {
  const { models } = useApp();
  const { settings, transcriber, corrector, switchLocked, setup } = models;
  const available = transcriber.available;
  return (
    <Dialog open={settings.open} onClose={settings.close} title="Einstellungen" size="md">
      {available ? (
        <>
          <ModelSection
            role="transcriber"
            setup={transcriber}
            locked={switchLocked.transcriber}
            onSetup={() => setup.show(['transcriber'])}
          />
          <ModelSection
            role="corrector"
            setup={corrector}
            locked={switchLocked.corrector}
            onSetup={() => setup.show(['corrector'])}
          />
          <DiagnosticsLog />
        </>
      ) : (
        <p className="settings-note">Modelle gibt es nur in der Desktop-App.</p>
      )}
      <p className="settings-about">
        Rotstift {packageInfo.version} · Alles bleibt auf diesem Rechner.
      </p>
    </Dialog>
  );
}
