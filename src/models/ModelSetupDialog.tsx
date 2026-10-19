import { useEffect, useRef, useState } from 'react';
import {
  describeDownloadError,
  formatMegabytes,
  formatMemory,
  formatSize,
  remainingText,
} from './format.ts';
import { isLowOnMemory, modelSource, totalBytes, type ModelInfo } from './registry.ts';
import type { ModelSetup } from './use-model-setup.ts';

interface Props {
  readonly setup: ModelSetup;
  readonly open: boolean;
  readonly onClose: () => void;
}

function useModalDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);
  return ref;
}

const MILESTONE_PERCENT = 10;

export function progressMilestone(downloaded: number, total: number): number {
  if (total <= 0) return 0;
  const percent = Math.min(100, Math.floor((downloaded / total) * 100));
  return Math.floor(percent / MILESTONE_PERCENT) * MILESTONE_PERCENT;
}

function Progress({ setup }: { readonly setup: ModelSetup }) {
  const { status, state } = setup;
  if (status === null) return null;
  const remaining = remainingText(state.samples, status.downloadedBytes, status.totalBytes);
  const amount = `${formatMegabytes(status.downloadedBytes)} von ${formatMegabytes(status.totalBytes)}`;
  const milestone = progressMilestone(status.downloadedBytes, status.totalBytes);
  return (
    <div className="download-progress">
      <progress
        value={status.downloadedBytes}
        max={status.totalBytes}
        aria-label="Download-Fortschritt"
        aria-valuetext={amount}
      />
      <p>
        {amount}
        {' · '}
        {remaining === null ? 'Restzeit wird geschätzt …' : `noch ${remaining}`}
      </p>
      <p role="status" className="visually-hidden">
        {`Download zu ${milestone} Prozent geladen`}
      </p>
    </div>
  );
}

function OfflineSetup({ model }: { readonly model: ModelInfo }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (name: string, url: string) => {
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(name);
      },
      () => {
        setCopied(null);
      },
    );
  };
  return (
    <details className="offline-setup">
      <summary>Ohne Internet einrichten</summary>
      <p>
        Auf einem Rechner mit Internet beide Dateien herunterladen und zum Beispiel per USB-Stick
        hierher bringen. Danach „Modell aus Datei importieren …“ wählen und beide Dateien auswählen.
        Rotstift prüft sie gegen die erwartete Prüfsumme.
      </p>
      <ul>
        {[model.files.model, model.files.mmproj].map((file) => (
          <li key={file.name}>
            <strong>{file.name}</strong> ({formatSize(file.bytes)})
            <code className="download-url">{file.url}</code>
            <button
              type="button"
              aria-label={`Adresse von ${file.name} kopieren`}
              onClick={() => {
                copy(file.name, file.url);
              }}
            >
              {copied === file.name ? 'Kopiert' : 'Adresse kopieren'}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ModelSetupDialog({ setup, open, onClose }: Props) {
  const ref = useModalDialog(open);
  const { model, status, state } = setup;
  const source = modelSource(model);
  const size = totalBytes(model);
  const ram = state.hardware?.totalRamBytes ?? null;
  const lowMemoryBytes = ram !== null && isLowOnMemory(model, ram) ? ram : null;
  const freeDisk = state.hardware?.freeDiskBytes ?? null;
  const lowDiskBytes =
    freeDisk !== null && status?.state !== 'downloading' && freeDisk < size ? freeDisk : null;
  const downloading = status?.state === 'downloading';
  const verifying = status?.state === 'verifying';
  const unverified = status?.state === 'unverified';
  const importing = status?.state === 'importing';
  const busyElsewhere = importing || status?.state === 'deleting';
  const idle = !downloading && !verifying && !busyElsewhere;
  const ready = status?.state === 'ready';
  const partial =
    status?.state !== 'ready' &&
    (status?.downloadedBytes ?? 0) > 0 &&
    !downloading &&
    !verifying &&
    !unverified &&
    !busyElsewhere;

  return (
    <dialog
      ref={ref}
      className="model-dialog"
      aria-labelledby="model-dialog-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <h2 id="model-dialog-title">Texterkennung einrichten</h2>

      {ready ? (
        <p role="status">
          Die Texterkennung ist eingerichtet. Wörter zählen funktioniert jetzt ohne Internet.
        </p>
      ) : (
        <>
          <p>
            Rotstift liest die Handschrift mit einem KI-Modell, das auf diesem Rechner läuft. Dieses
            Modell muss einmal heruntergeladen werden.
          </p>
          <dl className="model-facts">
            <dt>Modell</dt>
            <dd>{model.displayName}</dd>
            <dt>Größe</dt>
            <dd>{formatSize(size)}</dd>
            <dt>Quelle</dt>
            <dd>
              {source.host} ({source.repository}), Lizenz {model.license}
            </dd>
          </dl>
          <p className="privacy-note">
            <strong>Einmaliger Download, danach komplett offline.</strong> Es werden keine
            Schülerdaten übertragen.
          </p>
          {lowMemoryBytes !== null && (
            <p className="notice warn" role="alert">
              Dieser Rechner hat nur {formatMemory(lowMemoryBytes)} Arbeitsspeicher. Empfohlen sind
              mindestens {model.recommendedRamGb} GB. Die Texterkennung kann sehr langsam sein oder
              abbrechen. Bitte andere Programme schließen.
            </p>
          )}
          {lowDiskBytes !== null && (
            <p className="notice warn" role="alert">
              Auf diesem Laufwerk sind nur {formatSize(lowDiskBytes)} frei. Für das Modell werden{' '}
              {formatSize(size)} gebraucht.
            </p>
          )}
          {partial && status && (
            <p className="notice">
              Ein angefangener Download wird fortgesetzt ({formatMegabytes(status.downloadedBytes)}{' '}
              sind schon da).
            </p>
          )}
          {status?.state === 'corrupt' && (
            <p className="notice warn" role="alert">
              Die vorhandene Modelldatei ist unvollständig oder beschädigt und wird beim Download
              ersetzt.
            </p>
          )}
          {downloading && <Progress setup={setup} />}
          {verifying && (
            <p role="status">
              Die vorhandenen Modelldateien werden geprüft. Das dauert einen Moment.
            </p>
          )}
          {busyElsewhere && (
            <p role="status">
              {importing
                ? 'Die Modelldateien werden gerade importiert. Das dauert einen Moment.'
                : 'Das Modell wird gerade gelöscht.'}
            </p>
          )}
          {unverified && (
            <p className="notice warn" role="alert">
              Die vorhandenen Modelldateien konnten nicht geprüft werden.{' '}
              <button type="button" onClick={() => void setup.verifyAgain()}>
                Erneut prüfen
              </button>
            </p>
          )}
          {idle && <OfflineSetup model={model} />}
        </>
      )}

      {state.error !== null && (
        <p className="error-text" role="alert">
          {describeDownloadError(state.error)}
        </p>
      )}
      {state.note !== null && !ready && <p className="notice">{state.note}</p>}

      <div className="dialog-actions">
        {downloading && (
          <button type="button" onClick={() => void setup.cancel()}>
            Download abbrechen
          </button>
        )}
        {idle && !ready && (
          <>
            <button
              type="button"
              className="primary"
              disabled={state.importing || status === null}
              onClick={() => void setup.download()}
            >
              {partial ? 'Download fortsetzen' : `Herunterladen (${formatSize(size)})`}
            </button>
            <button
              type="button"
              disabled={state.importing}
              onClick={() => void setup.importFiles()}
            >
              {state.importing ? 'Dateien werden geprüft …' : 'Modell aus Datei importieren …'}
            </button>
          </>
        )}
        <button type="button" onClick={onClose}>
          {ready ? 'Fertig' : downloading ? 'Im Hintergrund laden' : 'Schließen'}
        </button>
      </div>
    </dialog>
  );
}
