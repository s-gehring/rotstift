import { useState } from 'react';
import { clearDiagnostics, readDiagnostics } from '../pipeline/diagnostics.ts';

export interface DiagnosticsSource {
  readonly read: () => Promise<readonly string[]>;
  readonly copy: (text: string) => Promise<void>;
  readonly clear: () => Promise<void>;
}

const browserSource: DiagnosticsSource = {
  read: () => readDiagnostics(),
  copy: (text) => navigator.clipboard.writeText(text),
  clear: () => clearDiagnostics(),
};

type CopyState = 'idle' | 'copied' | 'failed';

export function DiagnosticsLog({
  source = browserSource,
}: {
  readonly source?: DiagnosticsSource;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<readonly string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [copy, setCopy] = useState<CopyState>('idle');
  const [confirming, setConfirming] = useState(false);

  const load = () => {
    setFailed(false);
    source.read().then(setLines, () => {
      setFailed(true);
    });
  };

  const text = lines?.join('\n') ?? '';

  return (
    <details
      className="diagnostics"
      onToggle={(event) => {
        const opened = event.currentTarget.open;
        setOpen(opened);
        setConfirming(false);
        if (opened) load();
      }}
    >
      <summary>Diagnoseprotokoll</summary>
      <p>
        Das Protokoll enthält nur technische Angaben, zum Beispiel wie lange eine Seite gebraucht
        hat oder ob die Texterkennung neu gestartet wurde. Es enthält keine Schülertexte, keine
        Namen, keine Dateinamen und keine Bilder und wird nicht versendet. Bei Problemen können Sie
        es kopieren und selbst per E-Mail schicken.
      </p>
      {open && (
        <>
          {failed && <p role="alert">Das Protokoll konnte nicht gelesen werden.</p>}
          {lines !== null && (
            <pre className="diagnostics-entries" tabIndex={0} aria-label="Protokolleinträge">
              {lines.length === 0 ? 'Noch keine Einträge.' : text}
            </pre>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              disabled={lines === null || lines.length === 0}
              onClick={() => {
                source.copy(text).then(
                  () => {
                    setCopy('copied');
                  },
                  () => {
                    setCopy('failed');
                  },
                );
              }}
            >
              Kopieren
            </button>
            <button type="button" onClick={load}>
              Aktualisieren
            </button>
            <button
              type="button"
              className="danger"
              disabled={lines === null || lines.length === 0}
              onClick={() => {
                setConfirming(true);
              }}
            >
              Protokoll löschen
            </button>
          </div>
          {confirming && (
            <div className="confirm" role="alertdialog" aria-label="Protokoll löschen">
              <p>Das Diagnoseprotokoll wirklich löschen? Das lässt sich nicht rückgängig machen.</p>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setConfirming(false);
                  source.clear().then(load, () => {
                    setFailed(true);
                  });
                }}
              >
                Endgültig löschen
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Behalten
              </button>
            </div>
          )}
          <p role="status">
            {copy === 'copied' && 'Das Protokoll liegt in der Zwischenablage.'}
            {copy === 'failed' &&
              'Kopieren war nicht möglich. Bitte den Text markieren und selbst kopieren.'}
          </p>
        </>
      )}
    </details>
  );
}
