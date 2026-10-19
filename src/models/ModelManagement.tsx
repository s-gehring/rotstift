import { useEffect, useRef, useState } from 'react';
import { formatSize } from './format.ts';
import { totalBytes } from './registry.ts';
import type { ModelState } from './types.ts';
import type { ModelSetup } from './use-model-setup.ts';

interface Props {
  readonly setup: ModelSetup;
  readonly onSetup: () => void;
  readonly disabled: boolean;
}

const STATE_TEXT = {
  ready: 'Eingerichtet',
  missing: 'Nicht eingerichtet',
  downloading: 'Wird heruntergeladen',
  verifying: 'Wird geprüft',
  importing: 'Wird importiert',
  deleting: 'Wird gelöscht',
  unverified: 'Noch nicht geprüft',
  corrupt: 'Beschädigt, bitte neu laden',
} as const;

const BUSY_STATES: ReadonlySet<ModelState> = new Set([
  'downloading',
  'verifying',
  'importing',
  'deleting',
]);

export function ModelManagement({ setup, onSetup, disabled }: Props) {
  const { model, status } = setup;
  const [confirming, setConfirming] = useState(false);
  const keepButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) keepButton.current?.focus();
  }, [confirming]);

  if (!setup.available || status === null) return null;
  const hasFiles =
    status.state === 'ready' || status.state === 'corrupt' || status.downloadedBytes > 0;

  return (
    <section className="model-management" aria-label="Texterkennung verwalten">
      <details>
        <summary>Texterkennung verwalten</summary>
        <p>
          {model.displayName}: {STATE_TEXT[status.state]}
          {status.state === 'ready' &&
            ` (belegt ${formatSize(totalBytes(model))} auf der Festplatte)`}
        </p>
        {confirming ? (
          <div className="confirm" role="alertdialog" aria-label="Modell löschen">
            <p>
              Das Modell wirklich löschen? Zum Wörterzählen muss es danach erneut heruntergeladen
              werden.
            </p>
            <button
              type="button"
              className="danger"
              onClick={() => {
                setConfirming(false);
                void setup.remove();
              }}
            >
              Modell löschen
            </button>
            <button
              ref={keepButton}
              type="button"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Behalten
            </button>
          </div>
        ) : (
          <div className="dialog-actions">
            {status.state === 'unverified' && (
              <button type="button" onClick={() => void setup.verifyAgain()}>
                Erneut prüfen
              </button>
            )}
            {status.state !== 'ready' && (
              <button type="button" onClick={onSetup}>
                Texterkennung einrichten
              </button>
            )}
            {hasFiles && !BUSY_STATES.has(status.state) && (
              <button
                type="button"
                className="danger"
                disabled={disabled}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                Modell löschen
              </button>
            )}
          </div>
        )}
      </details>
    </section>
  );
}
