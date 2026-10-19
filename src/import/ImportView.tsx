import { useRef, type ChangeEvent } from 'react';
import { ACCEPT_ATTRIBUTE } from './load-files.ts';
import { PageCard } from './PageCard.tsx';
import { useFileDrop } from './use-file-drop.ts';
import { useImportPages } from './use-import-pages.ts';

export function ImportView() {
  const { pages, dispatch, addFiles, busy, errors, dismissErrors } = useImportPages();
  const input = useRef<HTMLInputElement>(null);
  const dropActive = useFileDrop(addFiles);

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  return (
    <section className="import" aria-labelledby="import-title">
      <div className="import-header">
        <h2 id="import-title">Arbeit laden</h2>
        <button type="button" className="primary" onClick={() => input.current?.click()}>
          Dateien auswählen
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          multiple
          hidden
          data-testid="file-input"
          onChange={onPick}
        />
      </div>
      <p className="hint">
        Bilder (PNG, JPEG, WebP) und PDF-Dateien lassen sich auch einfach in dieses Fenster ziehen.
        Jede PDF-Seite wird eine eigene Seite. Alles bleibt auf diesem Rechner.
      </p>

      {errors.length > 0 && (
        <div className="errors" role="alert">
          <ul>
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
          <button type="button" onClick={dismissErrors}>
            Schließen
          </button>
        </div>
      )}

      {pages.length === 0 ? (
        <p className="empty">{busy ? 'Seiten werden geladen …' : 'Noch keine Seiten geladen.'}</p>
      ) : (
        <>
          <div className="list-header">
            <p aria-live="polite">
              {pages.length} {pages.length === 1 ? 'Seite' : 'Seiten'}
              {busy && ' · weitere werden geladen …'}
            </p>
            <button type="button" disabled={busy} onClick={() => dispatch({ type: 'clear' })}>
              Alle entfernen
            </button>
          </div>
          <ol className="page-grid">
            {pages.map((page, index) => (
              <PageCard
                key={page.id}
                page={page}
                index={index}
                count={pages.length}
                onRotate={(direction) => dispatch({ type: 'rotate', id: page.id, direction })}
                onMove={(toIndex) => dispatch({ type: 'move', id: page.id, toIndex })}
                onRemove={() => dispatch({ type: 'remove', id: page.id })}
                onDropPage={(draggedId) =>
                  dispatch({ type: 'move', id: draggedId, toIndex: index })
                }
              />
            ))}
          </ol>
        </>
      )}

      <div className="submit-bar">
        <button type="button" className="primary" disabled aria-describedby="submit-hint">
          Berichtigen
        </button>
        <p id="submit-hint" className="hint">
          Die Korrektur folgt in einer späteren Version.
        </p>
      </div>

      {dropActive && (
        <div className="drop-overlay" aria-hidden="true">
          Dateien hier loslassen
        </div>
      )}
    </section>
  );
}
