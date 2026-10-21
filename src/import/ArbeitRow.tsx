import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { Button } from '../ui/Button.tsx';
import { Icon } from '../ui/icons.tsx';
import { MENU_SEPARATOR, Menu, type MenuEntry } from '../ui/Menu.tsx';
import { activityText, figureText, problemText, type ArbeitStatus } from './arbeit-status.ts';
import type { Arbeit } from './arbeiten.ts';
import { DRAG_TYPE, PageThumb, type MoveTarget } from './PageThumb.tsx';
import type { ImportPage } from './pages.ts';

const OPEN_DELAY_MS = 250;

interface NameFieldProps {
  readonly name: string;
  readonly onDone: (name: string | null, viaKeyboard: boolean) => void;
}

function NameField({ name, onDone }: NameFieldProps) {
  const field = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => field.current?.select(), []);
  const finish = (value: string | null, viaKeyboard: boolean) => {
    if (finished.current) return;
    finished.current = true;
    onDone(value, viaKeyboard);
  };
  return (
    <input
      ref={field}
      type="text"
      className="arbeit-name-field"
      aria-label="Name der Arbeit"
      defaultValue={name}
      autoFocus
      onBlur={(event) => finish(event.currentTarget.value, false)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(event.currentTarget.value, true);
        if (event.key === 'Escape') finish(null, true);
      }}
    />
  );
}

export interface ArbeitRowProps {
  readonly arbeit: Arbeit;
  readonly others: readonly MoveTarget[];
  readonly status: ArbeitStatus;
  readonly locked: boolean;
  readonly openable: boolean;
  readonly renaming: boolean;
  readonly canRetry: boolean;
  readonly onOpen: () => void;
  readonly onStartRename: () => void;
  readonly onFinishRename: (name: string | null, viaKeyboard: boolean) => void;
  readonly onMergeWith: (otherId: string) => void;
  readonly onRemove: () => void;
  readonly onRetry: () => void;
  readonly onPreviewPage: (page: ImportPage, index: number) => void;
  readonly onRotatePage: (
    pageId: string,
    index: number,
    direction: 'clockwise' | 'counterclockwise',
    via: 'button' | 'menu',
  ) => void;
  readonly onMovePage: (pageId: string, toIndex: number) => void;
  readonly onMovePageToArbeit: (pageId: string, index: number, target: string) => void;
  readonly onSplitPage: (pageId: string, index: number) => void;
  readonly onRemovePage: (pageId: string, index: number) => void;
  readonly onDropPage: (draggedId: string, toIndex: number) => void;
}

export function ArbeitRow({
  arbeit,
  others,
  status,
  locked,
  openable,
  renaming,
  canRetry,
  onOpen,
  onStartRename,
  onFinishRename,
  onMergeWith,
  onRemove,
  onRetry,
  onPreviewPage,
  onRotatePage,
  onMovePage,
  onMovePageToArbeit,
  onSplitPage,
  onRemovePage,
  onDropPage,
}: ArbeitRowProps) {
  const openTimer = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState(false);

  const cancelOpen = () => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    openTimer.current = null;
  };
  useEffect(
    () => () => {
      if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    },
    [],
  );

  const onNameClick = (event: MouseEvent) => {
    event.stopPropagation();
    cancelOpen();
    if (event.detail === 0) onOpen();
    else openTimer.current = window.setTimeout(onOpen, OPEN_DELAY_MS);
  };
  const onNameDoubleClick = () => {
    cancelOpen();
    onStartRename();
  };
  const onRowClick = (event: MouseEvent) => {
    if (!openable || !(event.target instanceof Element)) return;
    if (event.target.closest('button, input, [role="menu"], .thumbs') !== null) return;
    onOpen();
  };

  const onRowDragOver = (event: DragEvent<HTMLLIElement>) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(true);
  };
  const onRowDrop = (event: DragEvent<HTMLLIElement>) => {
    const draggedId = event.dataTransfer.getData(DRAG_TYPE);
    setDropTarget(false);
    if (draggedId === '') return;
    event.preventDefault();
    onDropPage(draggedId, arbeit.pages.length);
  };

  const merge: MenuEntry[] = others.map((other) => ({
    label: other.name,
    onSelect: () => onMergeWith(other.id),
  }));
  const items: MenuEntry[] = [
    { label: 'Umbenennen', icon: 'pencil', onSelect: onStartRename },
    { label: 'Zusammenführen mit', disabled: locked || merge.length === 0, items: merge },
    MENU_SEPARATOR,
    { label: 'Entfernen', icon: 'trash', danger: true, disabled: locked, onSelect: onRemove },
  ];

  const { words, errors, uncertain, activity, problems } = status;
  const figures: string[] = [];
  if (activity !== null) figures.push(activityText(activity));
  else {
    if (words !== null) figures.push(figureText(words, 'Wort', 'Wörter'));
    if (errors !== null) figures.push(figureText(errors, 'Fehler', 'Fehler'));
    if (uncertain > 0) figures.push(`${uncertain} unsicher`);
  }

  return (
    <li
      className={['arbeit-row', openable && 'is-openable', dropTarget && 'is-drop-target']
        .filter(Boolean)
        .join(' ')}
      data-arbeit-id={arbeit.id}
      onClick={onRowClick}
      onDragOver={onRowDragOver}
      onDragLeave={() => setDropTarget(false)}
      onDrop={onRowDrop}
    >
      <div className="arbeit-head">
        {renaming ? (
          <NameField name={arbeit.name} onDone={onFinishRename} />
        ) : openable ? (
          <button
            type="button"
            className="arbeit-name"
            title={`${arbeit.name} öffnen`}
            onClick={onNameClick}
            onDoubleClick={onNameDoubleClick}
          >
            {arbeit.name}
          </button>
        ) : (
          <span className="arbeit-name" onDoubleClick={onNameDoubleClick}>
            {arbeit.name}
          </span>
        )}
        <span className="arbeit-figures">
          {figures.map((text, index) => (
            <span
              key={text}
              className={index === 0 && activity !== null ? 'is-activity' : undefined}
            >
              {text}
            </span>
          ))}
        </span>
        <Menu label={`Weitere Aktionen für ${arbeit.name}`} items={items} />
      </div>
      {problems.length > 0 && activity === null && (
        <p className="arbeit-problem">
          <Icon name="alert" />
          <span className="arbeit-problem-text" title={problems.map((p) => p.text).join('\n')}>
            {problemText(problems)}
          </span>
          <Button variant="quiet" disabled={locked || !canRetry} onClick={onRetry}>
            Erneut versuchen
          </Button>
        </p>
      )}
      <ol className="thumbs" aria-label={`Seiten von ${arbeit.name}`}>
        {arbeit.pages.map((page, index) => (
          <PageThumb
            key={page.id}
            page={page}
            index={index}
            count={arbeit.pages.length}
            arbeitName={arbeit.name}
            moveTargets={others}
            locked={locked}
            onOpen={() => onPreviewPage(page, index)}
            onRotate={(direction, via) => onRotatePage(page.id, index, direction, via)}
            onMove={(toIndex) => onMovePage(page.id, toIndex)}
            onMoveToArbeit={(target) => onMovePageToArbeit(page.id, index, target)}
            onSplitHere={() => onSplitPage(page.id, index)}
            onRemove={() => onRemovePage(page.id, index)}
            onDropPage={(draggedId) => onDropPage(draggedId, index)}
          />
        ))}
      </ol>
    </li>
  );
}
