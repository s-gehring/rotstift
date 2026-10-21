import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useApp } from '../app/app-context.tsx';
import { Button } from '../ui/Button.tsx';
import { Icon } from '../ui/icons.tsx';
import { Menu } from '../ui/Menu.tsx';
import { ArbeitRow } from './ArbeitRow.tsx';
import { arbeitStatus, figureText, type Figure } from './arbeit-status.ts';
import { findPage, type Arbeit } from './arbeiten.ts';
import { ACCEPT_ATTRIBUTE } from './file-kind.ts';
import { NEW_ARBEIT } from './PageThumb.tsx';
import { PagePreviewDialog, type PreviewTarget } from './PagePreviewDialog.tsx';
import './klasse.css';

type FocusRequest =
  | { readonly kind: 'page'; readonly pageId: string; readonly control: 'rotate' | 'menu' }
  | { readonly kind: 'arbeit'; readonly arbeitId: string }
  | { readonly kind: 'position'; readonly index: number };

function pageCountText(count: number): string {
  return `${count} ${count === 1 ? 'Seite' : 'Seiten'}`;
}

function arbeitCountText(count: number): string {
  return `${count} ${count === 1 ? 'Arbeit' : 'Arbeiten'}`;
}

function sumFigures(figures: readonly (Figure | null)[]): Figure | null {
  const present = figures.filter((figure) => figure !== null);
  if (present.length === 0) return null;
  return {
    value: present.reduce((sum, figure) => sum + figure.value, 0),
    partial: present.length < figures.length || present.some((figure) => figure.partial),
  };
}

export function KlasseView() {
  const { importState, run, work, navigation, toasts } = useApp();
  const { arbeiten, pages, dispatch, addFiles, busy, undo } = importState;
  const { show } = toasts;
  const locked = run.running;
  const entries = work.count.state.entries;
  const review = work.review.state;

  const [announcement, setAnnouncement] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const focusRequest = useRef<FocusRequest | null>(null);

  const statuses = useMemo(
    () => arbeiten.map((arbeit) => arbeitStatus(arbeit, entries, review)),
    [arbeiten, entries, review],
  );

  useEffect(() => {
    const request = focusRequest.current;
    focusRequest.current = null;
    if (request === null || root.current === null) return;
    const scope = root.current;
    const trigger = (container: Element | null | undefined) =>
      container?.querySelector<HTMLElement>('[aria-haspopup="menu"]:not(:disabled)');
    const thumbs = Array.from(scope.querySelectorAll<HTMLElement>('[data-page-id]'));
    let target: HTMLElement | null | undefined;
    if (request.kind === 'page') {
      const thumb = thumbs.find((element) => element.dataset['pageId'] === request.pageId);
      const rotate = thumb?.querySelector<HTMLElement>('[data-action="rotate"]:not(:disabled)');
      target = request.control === 'rotate' && rotate != null ? rotate : trigger(thumb);
    } else if (request.kind === 'arbeit') {
      const row = Array.from(scope.querySelectorAll<HTMLElement>('[data-arbeit-id]')).find(
        (element) => element.dataset['arbeitId'] === request.arbeitId,
      );
      target = trigger(row?.querySelector('.arbeit-head'));
    } else {
      const thumb = thumbs[Math.min(request.index, thumbs.length - 1)];
      target =
        thumb?.querySelector<HTMLElement>('.thumb-open') ??
        trigger(scope) ??
        scope.querySelector<HTMLElement>('button');
    }
    target?.focus();
  });

  const openPicker = () => input.current?.click();

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const offerUndo = (text: string) =>
    show(text, {
      action: {
        label: 'Rückgängig',
        onAction: () => {
          undo();
          setAnnouncement('Entfernen rückgängig gemacht.');
        },
      },
    });

  const moveTo = (arbeit: Arbeit, id: string, toIndex: number, refocus: boolean) => {
    const from = arbeit.pages.findIndex((page) => page.id === id);
    const to = Math.min(Math.max(toIndex, 0), arbeit.pages.length - 1);
    if (from < 0 || from === to) return;
    if (refocus) focusRequest.current = { kind: 'page', pageId: id, control: 'menu' };
    dispatch({ type: 'place', pageId: id, arbeitId: arbeit.id, toIndex });
    setAnnouncement(
      `Seite ${from + 1} von ${arbeit.name} steht jetzt an Position ${to + 1} von ${arbeit.pages.length}.`,
    );
  };

  const dropOn = (arbeit: Arbeit, draggedId: string, toIndex: number) => {
    const source = findPage(arbeiten, draggedId);
    if (source === undefined) return;
    if (source.arbeit.id === arbeit.id) {
      moveTo(arbeit, draggedId, toIndex, false);
      return;
    }
    focusRequest.current = { kind: 'page', pageId: draggedId, control: 'menu' };
    dispatch({ type: 'place', pageId: draggedId, arbeitId: arbeit.id, toIndex });
    setAnnouncement(`Seite aus ${source.arbeit.name} nach ${arbeit.name} verschoben.`);
  };

  const moveToArbeit = (arbeit: Arbeit, pageId: string, index: number, target: string) => {
    focusRequest.current = { kind: 'page', pageId, control: 'menu' };
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

  const splitAt = (arbeit: Arbeit, pageId: string, index: number) => {
    focusRequest.current = { kind: 'page', pageId, control: 'menu' };
    dispatch({ type: 'split-from', pageId, newArbeitId: crypto.randomUUID() });
    setAnnouncement(
      `Ab Seite ${index + 1} von ${arbeit.name} ist jetzt eine neue Arbeit mit ${pageCountText(arbeit.pages.length - index)}.`,
    );
  };

  const rotate = (
    arbeit: Arbeit,
    pageId: string,
    index: number,
    direction: 'clockwise' | 'counterclockwise',
    via: 'button' | 'menu',
  ) => {
    focusRequest.current = {
      kind: 'page',
      pageId,
      control: via === 'button' ? 'rotate' : 'menu',
    };
    dispatch({ type: 'rotate', pageId, direction });
    setAnnouncement(
      `Seite ${index + 1} von ${arbeit.name} nach ${direction === 'clockwise' ? 'rechts' : 'links'} gedreht.`,
    );
  };

  const removePage = (arbeit: Arbeit, pageId: string, index: number) => {
    focusRequest.current = {
      kind: 'position',
      index: pages.findIndex((page) => page.id === pageId),
    };
    dispatch({ type: 'remove-page', pageId });
    const emptied = arbeit.pages.length === 1;
    setAnnouncement(
      emptied
        ? `Seite ${index + 1} entfernt. ${arbeit.name} ist damit leer und wurde entfernt.`
        : `Seite ${index + 1} von ${arbeit.name} entfernt. ${pageCountText(arbeit.pages.length - 1)} übrig.`,
    );
    offerUndo(emptied ? `${arbeit.name} entfernt` : `Seite ${index + 1} entfernt`);
  };

  const removeArbeit = (arbeit: Arbeit) => {
    focusRequest.current = {
      kind: 'position',
      index: pages.findIndex((page) => page.id === arbeit.pages[0]?.id),
    };
    dispatch({ type: 'remove-arbeit', id: arbeit.id });
    setAnnouncement(`${arbeit.name} entfernt.`);
    offerUndo(`${arbeit.name} entfernt`);
  };

  const clear = () => {
    focusRequest.current = { kind: 'position', index: 0 };
    dispatch({ type: 'clear' });
    setAnnouncement('Alle Arbeiten entfernt.');
    offerUndo('Alle Arbeiten entfernt');
  };

  const merge = (arbeit: Arbeit, otherId: string) => {
    const other = arbeiten.find((candidate) => candidate.id === otherId);
    if (other === undefined) return;
    const first = arbeiten.indexOf(arbeit) < arbeiten.indexOf(other) ? arbeit : other;
    focusRequest.current = { kind: 'arbeit', arbeitId: first.id };
    dispatch({ type: 'merge', ids: [arbeit.id, other.id] });
    setAnnouncement(`${arbeit.name} und ${other.name} zu „${first.name}“ zusammengeführt.`);
  };

  const finishRename = (arbeit: Arbeit, name: string | null, viaKeyboard: boolean) => {
    setRenamingId(null);
    if (viaKeyboard) focusRequest.current = { kind: 'arbeit', arbeitId: arbeit.id };
    if (name !== null) dispatch({ type: 'rename', id: arbeit.id, name });
  };

  const retry = (arbeit: Arbeit, index: number) => {
    const { problems } = statuses[index] ?? { problems: [] };
    void (async () => {
      for (const problem of problems) {
        if (problem.source === 'review') await work.review.flow.retry(problem.page);
        else work.count.runner.retry(problem.page.id);
      }
    })();
    setAnnouncement(`${arbeit.name}: Seiten werden erneut verarbeitet.`);
  };

  const hasResults = statuses.some((status) => status.hasResults);
  const classWords = sumFigures(statuses.map((status) => status.words));
  const classErrors = sumFigures(statuses.map((status) => status.errors));
  const summary = [arbeitCountText(arbeiten.length), pageCountText(pages.length)];
  if (hasResults && classWords !== null) summary.push(figureText(classWords, 'Wort', 'Wörter'));
  if (hasResults && classErrors !== null) summary.push(figureText(classErrors, 'Fehler', 'Fehler'));
  if (busy) summary.push('Wird geladen …');

  return (
    <div className="klasse" ref={root}>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        hidden
        data-testid="file-input"
        onChange={onPick}
      />

      {arbeiten.length === 0 ? (
        <div className="klasse-drop">
          <Icon name="upload" size={32} />
          <p className="klasse-drop-title">Arbeiten hierher ziehen</p>
          <Button onClick={openPicker}>Dateien auswählen</Button>
          <p className="klasse-drop-note" role={busy ? 'status' : undefined}>
            {busy ? 'Wird geladen …' : 'PDF oder Bilder. Alles bleibt auf diesem Rechner.'}
          </p>
        </div>
      ) : (
        <>
          <div className="klasse-head">
            <p className="klasse-summary">{summary.join(' · ')}</p>
            {hasResults && (
              <Button variant="quiet" onClick={navigation.openOverview}>
                Übersicht
              </Button>
            )}
            <Menu
              label="Weitere Aktionen für die Klasse"
              items={[
                {
                  label: 'Dateien hinzufügen',
                  icon: 'plus',
                  disabled: locked,
                  onSelect: openPicker,
                },
                {
                  label: 'Alle entfernen',
                  icon: 'trash',
                  danger: true,
                  disabled: locked || busy,
                  onSelect: clear,
                },
              ]}
            />
          </div>
          <ul className="arbeit-rows">
            {arbeiten.map((arbeit, index) => {
              const status = statuses[index];
              if (status === undefined) return null;
              return (
                <ArbeitRow
                  key={arbeit.id}
                  arbeit={arbeit}
                  others={arbeiten
                    .filter((other) => other.id !== arbeit.id)
                    .map((other) => ({ id: other.id, name: other.name }))}
                  status={status}
                  locked={locked}
                  openable={status.hasResults}
                  renaming={renamingId === arbeit.id}
                  canRetry={work.canRetryReview || work.canRetryCount}
                  onOpen={() => navigation.openArbeit(arbeit.id)}
                  onStartRename={() => setRenamingId(arbeit.id)}
                  onFinishRename={(name, viaKeyboard) => finishRename(arbeit, name, viaKeyboard)}
                  onMergeWith={(otherId) => merge(arbeit, otherId)}
                  onRemove={() => removeArbeit(arbeit)}
                  onRetry={() => retry(arbeit, index)}
                  onPreviewPage={(page, position) =>
                    setPreview({ page, title: `${arbeit.name}, Seite ${position + 1}` })
                  }
                  onRotatePage={(pageId, position, direction, via) =>
                    rotate(arbeit, pageId, position, direction, via)
                  }
                  onMovePage={(pageId, toIndex) => moveTo(arbeit, pageId, toIndex, true)}
                  onMovePageToArbeit={(pageId, position, target) =>
                    moveToArbeit(arbeit, pageId, position, target)
                  }
                  onSplitPage={(pageId, position) => splitAt(arbeit, pageId, position)}
                  onRemovePage={(pageId, position) => removePage(arbeit, pageId, position)}
                  onDropPage={(draggedId, toIndex) => dropOn(arbeit, draggedId, toIndex)}
                />
              );
            })}
          </ul>
        </>
      )}

      <PagePreviewDialog target={preview} onClose={() => setPreview(null)} />
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </div>
  );
}
