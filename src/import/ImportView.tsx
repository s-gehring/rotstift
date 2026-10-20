import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ACCEPT_ATTRIBUTE } from './file-kind.ts';
import { findPage, type Arbeit } from './arbeiten.ts';
import { NEW_ARBEIT, PageCard } from './PageCard.tsx';
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

function arbeitCountText(count: number): string {
  return `${count} ${count === 1 ? 'Arbeit' : 'Arbeiten'}`;
}

interface ImportViewProps {
  readonly importState: ReturnType<typeof useImportPages>;
  readonly locked?: boolean;
  readonly onOpenArbeit?: (arbeitId: string) => void;
}

function ArbeitName({
  name,
  onRename,
}: {
  readonly name: string;
  readonly onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) onRename(draft);
    setDraft(null);
  };
  return (
    <input
      type="text"
      className="arbeit-name"
      aria-label="Name der Arbeit"
      value={draft ?? name}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') setDraft(null);
      }}
    />
  );
}

export function ImportView({ importState, locked = false, onOpenArbeit }: ImportViewProps) {
  const { arbeiten, pages, dispatch, addFiles, busy, notices, dismissNotices } = importState;
  const [announcement, setAnnouncement] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  const pickButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const focusRequest = useRef<FocusRequest | null>(null);
  const chosen = arbeiten.filter((arbeit) => selected.has(arbeit.id));

  useEffect(() => {
    const request = focusRequest.current;
    focusRequest.current = null;
    if (request === null) return;
    const cards = Array.from(list.current?.querySelectorAll<HTMLElement>('[data-page-id]') ?? []);
    if (request.kind === 'card') {
      const card = cards[Math.min(request.index, cards.length - 1)];
      (card?.querySelector<HTMLElement>('button') ?? pickButton.current)?.focus();
      return;
    }
    const card = cards.find((element) => element.dataset['pageId'] === request.pageId);
    const target = [request.action, request.fallback]
      .map((action) => card?.querySelector<HTMLElement>(`[data-action="${action}"]`))
      .find((control) => control != null && !control.matches(':disabled'));
    target?.focus();
  });

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const moveTo = (arbeit: Arbeit, id: string, toIndex: number, action?: string) => {
    const from = arbeit.pages.findIndex((page) => page.id === id);
    const to = Math.min(Math.max(toIndex, 0), arbeit.pages.length - 1);
    if (from < 0 || from === to) return;
    if (action !== undefined) {
      focusRequest.current = {
        kind: 'button',
        pageId: id,
        action,
        fallback: action === 'move-earlier' ? 'move-later' : 'move-earlier',
      };
    }
    dispatch({ type: 'place', pageId: id, arbeitId: arbeit.id, toIndex });
    setAnnouncement(
      `Seite ${from + 1} von ${arbeit.name} steht jetzt an Position ${to + 1} von ${arbeit.pages.length}.`,
    );
  };

  const dropOn = (arbeit: Arbeit, draggedId: string, toIndex: number) => {
    const source = findPage(arbeiten, draggedId);
    if (source === undefined) return;
    if (source.arbeit.id === arbeit.id) {
      moveTo(arbeit, draggedId, toIndex);
      return;
    }
    focusRequest.current = {
      kind: 'button',
      pageId: draggedId,
      action: 'move-arbeit',
      fallback: 'rotate-right',
    };
    dispatch({ type: 'place', pageId: draggedId, arbeitId: arbeit.id, toIndex });
    setAnnouncement(`Seite aus ${source.arbeit.name} nach ${arbeit.name} verschoben.`);
  };

  const moveToArbeit = (arbeit: Arbeit, pageId: string, index: number, target: string) => {
    focusRequest.current = {
      kind: 'button',
      pageId,
      action: 'move-arbeit',
      fallback: 'rotate-right',
    };
    if (target === NEW_ARBEIT) {
      dispatch({ type: 'split', pageId, newArbeitId: crypto.randomUUID() });
      setAnnouncement(`Seite ${index + 1} von ${arbeit.name} ist jetzt eine eigene Arbeit.`);
      return;
    }
    const destination = arbeiten.find((candidate) => candidate.id === target);
    if (destination === undefined) return;
    dispatch({ type: 'place', pageId, arbeitId: target, toIndex: destination.pages.length });
    setAnnouncement(
      `Seite ${index + 1} von ${arbeit.name} nach ${destination.name} verschoben.${
        arbeit.pages.length === 1 ? ` ${arbeit.name} ist damit leer und wurde entfernt.` : ''
      }`,
    );
  };

  const rotate = (
    arbeit: Arbeit,
    id: string,
    direction: 'clockwise' | 'counterclockwise',
    index: number,
  ) => {
    focusRequest.current = {
      kind: 'button',
      pageId: id,
      action: direction === 'clockwise' ? 'rotate-right' : 'rotate-left',
      fallback: 'rotate-right',
    };
    dispatch({ type: 'rotate', pageId: id, direction });
    setAnnouncement(
      `Seite ${index + 1} von ${arbeit.name} nach ${direction === 'clockwise' ? 'rechts' : 'links'} gedreht.`,
    );
  };

  const removePage = (arbeit: Arbeit, id: string, index: number) => {
    const flatIndex = pages.findIndex((page) => page.id === id);
    focusRequest.current = { kind: 'card', index: flatIndex };
    dispatch({ type: 'remove-page', pageId: id });
    setAnnouncement(
      arbeit.pages.length === 1
        ? `Seite ${index + 1} entfernt. ${arbeit.name} ist damit leer und wurde entfernt.`
        : `Seite ${index + 1} von ${arbeit.name} entfernt. ${pageCountText(arbeit.pages.length - 1)} übrig.`,
    );
  };

  const removeArbeit = (arbeit: Arbeit) => {
    const flatIndex = pages.findIndex((page) => page.id === arbeit.pages[0]?.id);
    focusRequest.current = { kind: 'card', index: flatIndex };
    dispatch({ type: 'remove-arbeit', id: arbeit.id });
    setSelected((current) => new Set([...current].filter((id) => id !== arbeit.id)));
    setAnnouncement(`${arbeit.name} entfernt.`);
  };

  const clear = () => {
    focusRequest.current = { kind: 'card', index: 0 };
    dispatch({ type: 'clear' });
    setSelected(new Set());
    setAnnouncement('Alle Arbeiten entfernt.');
  };

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const merge = () => {
    const [first] = chosen;
    if (first === undefined || chosen.length < 2) return;
    dispatch({ type: 'merge', ids: chosen.map((arbeit) => arbeit.id) });
    setSelected(new Set());
    setAnnouncement(`${arbeitCountText(chosen.length)} zu „${first.name}“ zusammengeführt.`);
  };

  return (
    <section className="import" aria-label="Arbeiten">
      <div className="import-header">
        <button ref={pickButton} type="button" onClick={() => input.current?.click()}>
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

      {arbeiten.length === 0 ? (
        <p className="empty">{busy ? 'Seiten werden geladen …' : 'Noch keine Arbeiten geladen.'}</p>
      ) : (
        <fieldset className="lock-area" disabled={locked}>
          <div className="list-header">
            <p>
              {arbeitCountText(arbeiten.length)} · {pageCountText(pages.length)}
              {busy && ' · weitere werden geladen …'}
            </p>
            {arbeiten.length > 1 && (
              <button type="button" disabled={chosen.length < 2} onClick={merge}>
                Ausgewählte zusammenführen
              </button>
            )}
            <button type="button" disabled={busy} onClick={clear}>
              Alle entfernen
            </button>
          </div>
          <ul className="arbeit-list" ref={list}>
            {arbeiten.map((arbeit) => (
              <li key={arbeit.id} className="arbeit">
                <div className="arbeit-header">
                  {arbeiten.length > 1 && (
                    <input
                      type="checkbox"
                      checked={selected.has(arbeit.id)}
                      aria-label={`${arbeit.name} zum Zusammenführen auswählen`}
                      onChange={() => toggle(arbeit.id)}
                    />
                  )}
                  <ArbeitName
                    name={arbeit.name}
                    onRename={(name) => dispatch({ type: 'rename', id: arbeit.id, name })}
                  />
                  <span className="hint">{pageCountText(arbeit.pages.length)}</span>
                  {onOpenArbeit !== undefined && (
                    <button type="button" onClick={() => onOpenArbeit(arbeit.id)}>
                      Öffnen
                    </button>
                  )}
                  <button
                    type="button"
                    className="danger"
                    aria-label={`${arbeit.name} entfernen`}
                    onClick={() => removeArbeit(arbeit)}
                  >
                    Arbeit entfernen
                  </button>
                </div>
                <ol className="page-grid">
                  {arbeit.pages.map((page, index) => (
                    <PageCard
                      key={page.id}
                      page={page}
                      index={index}
                      count={arbeit.pages.length}
                      arbeitName={arbeit.name}
                      moveTargets={arbeiten
                        .filter((other) => other.id !== arbeit.id)
                        .map((other) => ({ id: other.id, name: other.name }))}
                      canSplit={arbeit.pages.length > 1}
                      onRotate={(direction) => rotate(arbeit, page.id, direction, index)}
                      onMove={(toIndex) =>
                        moveTo(
                          arbeit,
                          page.id,
                          toIndex,
                          toIndex < index ? 'move-earlier' : 'move-later',
                        )
                      }
                      onRemove={() => removePage(arbeit, page.id, index)}
                      onMoveToArbeit={(target) => moveToArbeit(arbeit, page.id, index, target)}
                      onDropPage={(draggedId) => dropOn(arbeit, draggedId, index)}
                    />
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <p className="sr-only" role="status">
        {announcement}
      </p>
    </section>
  );
}
