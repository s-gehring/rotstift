import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { ACCEPT_ATTRIBUTE } from './file-kind.ts';
import { PageCard } from './PageCard.tsx';
import type { PagesAction } from './pages.ts';
import { useFileDrop } from './use-file-drop.ts';
import type { useImportPages } from './use-import-pages.ts';

type FocusRequest =
  | {
      readonly kind: 'button';
      readonly pageId: string;
      readonly action: string;
      readonly fallback: string;
    }
  | { readonly kind: 'card'; readonly index: number };

function pageCountText(count: number): string {
  return `${count} ${count === 1 ? 'Seite' : 'Seiten'}`;
}

interface ImportViewProps {
  readonly importState: ReturnType<typeof useImportPages>;
  readonly actions?: ReactNode;
  readonly footer?: ReactNode;
}

export function ImportView({ importState, actions, footer }: ImportViewProps) {
  const { pages, dispatch, addFiles, busy, notices, dismissNotices } = importState;
  const [announcement, setAnnouncement] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const pickButton = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLOListElement>(null);
  const focusRequest = useRef<FocusRequest | null>(null);
  const dropActive = useFileDrop(addFiles);

  useEffect(() => {
    const request = focusRequest.current;
    focusRequest.current = null;
    if (request === null) return;
    const cards = Array.from(grid.current?.querySelectorAll<HTMLElement>('[data-page-id]') ?? []);
    if (request.kind === 'card') {
      const card = cards[Math.min(request.index, cards.length - 1)];
      (card?.querySelector<HTMLElement>('button') ?? pickButton.current)?.focus();
      return;
    }
    const card = cards.find((element) => element.dataset['pageId'] === request.pageId);
    const target = [request.action, request.fallback]
      .map((action) => card?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`))
      .find((button) => button != null && !button.disabled);
    target?.focus();
  });

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const moveTo = (id: string, toIndex: number, action?: string) => {
    const from = pages.findIndex((page) => page.id === id);
    const to = Math.min(Math.max(toIndex, 0), pages.length - 1);
    if (from < 0 || from === to) return;
    if (action !== undefined) {
      focusRequest.current = {
        kind: 'button',
        pageId: id,
        action,
        fallback: action === 'move-earlier' ? 'move-later' : 'move-earlier',
      };
    }
    dispatch({ type: 'move', id, toIndex });
    setAnnouncement(`Seite ${from + 1} steht jetzt an Position ${to + 1} von ${pages.length}.`);
  };

  const rotate = (id: string, direction: 'clockwise' | 'counterclockwise', index: number) => {
    const action: PagesAction = { type: 'rotate', id, direction };
    focusRequest.current = {
      kind: 'button',
      pageId: id,
      action: direction === 'clockwise' ? 'rotate-right' : 'rotate-left',
      fallback: 'rotate-right',
    };
    dispatch(action);
    setAnnouncement(
      `Seite ${index + 1} nach ${direction === 'clockwise' ? 'rechts' : 'links'} gedreht.`,
    );
  };

  const remove = (id: string, index: number) => {
    focusRequest.current = { kind: 'card', index };
    dispatch({ type: 'remove', id });
    setAnnouncement(`Seite ${index + 1} entfernt. ${pageCountText(pages.length - 1)} übrig.`);
  };

  const clear = () => {
    focusRequest.current = { kind: 'card', index: 0 };
    dispatch({ type: 'clear' });
    setAnnouncement('Alle Seiten entfernt.');
  };

  return (
    <section className="import" aria-labelledby="import-title">
      <div className="import-header">
        <h2 id="import-title">Arbeit laden</h2>
        <button
          ref={pickButton}
          type="button"
          className="primary"
          onClick={() => input.current?.click()}
        >
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

      {notices.length > 0 && (
        <div className="errors" role="alert">
          <ul>
            {notices.map((notice) => (
              <li key={notice.id}>{notice.text}</li>
            ))}
          </ul>
          <button type="button" onClick={dismissNotices}>
            Schließen
          </button>
        </div>
      )}

      {pages.length === 0 ? (
        <p className="empty">{busy ? 'Seiten werden geladen …' : 'Noch keine Seiten geladen.'}</p>
      ) : (
        <>
          <div className="list-header">
            <p>
              {pageCountText(pages.length)}
              {busy && ' · weitere werden geladen …'}
            </p>
            <button type="button" disabled={busy} onClick={clear}>
              Alle entfernen
            </button>
          </div>
          <ol className="page-grid" ref={grid}>
            {pages.map((page, index) => (
              <PageCard
                key={page.id}
                page={page}
                index={index}
                count={pages.length}
                onRotate={(direction) => rotate(page.id, direction, index)}
                onMove={(toIndex) =>
                  moveTo(page.id, toIndex, toIndex < index ? 'move-earlier' : 'move-later')
                }
                onRemove={() => remove(page.id, index)}
                onDropPage={(draggedId) => moveTo(draggedId, index)}
              />
            ))}
          </ol>
        </>
      )}

      <div className="submit-bar">
        {actions}
        <button type="button" disabled aria-describedby="submit-hint">
          Berichtigen
        </button>
        <p id="submit-hint" className="hint">
          Die Korrektur folgt in einer späteren Version.
        </p>
      </div>
      {footer}

      <p className="sr-only" role="status">
        {announcement}
      </p>

      {dropActive && (
        <div className="drop-overlay" aria-hidden="true">
          Dateien hier loslassen
        </div>
      )}
    </section>
  );
}
