import { useEffect, useRef, useState } from 'react';
import packageInfo from '../../package.json';
import { useApp } from '../app/app-context.tsx';
import type { ModelRole } from '../app/types.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { DiagnosticsLog } from './DiagnosticsLog.tsx';
import { describeDownloadError, formatSize } from './format.ts';
import { ModelChoice } from './ModelChoice.tsx';
import { totalBytes, type AnyModelInfo } from './registry.ts';
import { ROLE_NAME } from './role-text.ts';
import type { ModelState } from './types.ts';
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
  const [confirming, setConfirming] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) keep.current?.focus();
  }, [confirming]);
  const { model, status } = setup;
  const state = status?.state ?? null;
  const busy = state !== null && BUSY.has(state);
  const hasFiles = state === 'ready' || state === 'corrupt' || (status?.downloadedBytes ?? 0) > 0;
  const headingId = `settings-${role}`;
  return (
    <section className="settings-section" aria-labelledby={headingId}>
      <h3 id={headingId}>{ROLE_NAME[role]}</h3>
      <ModelChoice setup={setup} disabled={locked} />
      <div className="settings-model">
        <span className="settings-model-name">{model.displayName}</span>
        <span className="settings-model-size">{formatSize(totalBytes(model))}</span>
        <span className="settings-model-state" data-state={state ?? 'unknown'}>
          {state === null ? '' : STATE_TEXT[state]}
        </span>
      </div>
      {setup.error !== null && (
        <p className="settings-error" role="alert">
          {describeDownloadError(setup.error)}
        </p>
      )}
      {setup.state.note !== null && <p className="settings-note">{setup.state.note}</p>}
      {confirming ? (
        <div className="confirm" role="alertdialog" aria-label={`${ROLE_NAME[role]} löschen`}>
          <p>{ROLE_NAME[role]} wirklich löschen?</p>
          <Button
            variant="quiet"
            className="is-danger"
            onClick={() => {
              setConfirming(false);
              void setup.remove();
            }}
          >
            Löschen
          </Button>
          <Button ref={keep} onClick={() => setConfirming(false)}>
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
          {hasFiles && !busy && (
            <Button
              variant="quiet"
              className="is-danger"
              disabled={locked}
              onClick={() => setConfirming(true)}
            >
              Löschen
            </Button>
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
