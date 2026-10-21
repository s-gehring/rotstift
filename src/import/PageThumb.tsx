import { useState, type DragEvent } from 'react';
import { IconButton } from '../ui/IconButton.tsx';
import { MENU_SEPARATOR, Menu, type MenuEntry } from '../ui/Menu.tsx';
import { rotatedSize, type ImportPage } from './pages.ts';

const STAGE_WIDTH = 36;
const STAGE_HEIGHT = 50;
export const DRAG_TYPE = 'application/x-rotstift-page';
export const NEW_ARBEIT = 'new';

export interface MoveTarget {
  readonly id: string;
  readonly name: string;
}

interface PageThumbProps {
  readonly page: ImportPage;
  readonly index: number;
  readonly count: number;
  readonly arbeitName: string;
  readonly moveTargets: readonly MoveTarget[];
  readonly locked: boolean;
  readonly onOpen: () => void;
  readonly onRotate: (direction: 'clockwise' | 'counterclockwise', via: 'button' | 'menu') => void;
  readonly onMove: (toIndex: number) => void;
  readonly onMoveToArbeit: (target: string) => void;
  readonly onSplitHere: () => void;
  readonly onRemove: () => void;
  readonly onDropPage: (draggedId: string) => void;
}

export function PageThumb({
  page,
  index,
  count,
  arbeitName,
  moveTargets,
  locked,
  onOpen,
  onRotate,
  onMove,
  onMoveToArbeit,
  onSplitHere,
  onRemove,
  onDropPage,
}: PageThumbProps) {
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);

  const number = index + 1;
  const name = `Seite ${number} von ${arbeitName}`;
  const visible = rotatedSize(page);
  const scale = Math.min(STAGE_WIDTH / visible.width, STAGE_HEIGHT / visible.height);
  const imageStyle = {
    width: page.width * scale,
    height: page.height * scale,
    transform: `translate(-50%, -50%) rotate(${page.rotation}deg)`,
  };

  const onDragStart = (event: DragEvent<HTMLLIElement>) => {
    event.stopPropagation();
    event.dataTransfer.setData(DRAG_TYPE, page.id);
    event.dataTransfer.effectAllowed = 'move';
    setDragging(true);
  };
  const onDragOver = (event: DragEvent<HTMLLIElement>) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(true);
  };
  const onDrop = (event: DragEvent<HTMLLIElement>) => {
    const draggedId = event.dataTransfer.getData(DRAG_TYPE);
    setDropTarget(false);
    if (draggedId === '') return;
    event.preventDefault();
    event.stopPropagation();
    onDropPage(draggedId);
  };

  const canSplitOff = count > 1;
  const targets: MenuEntry[] = moveTargets.map((target) => ({
    label: target.name,
    onSelect: () => onMoveToArbeit(target.id),
  }));
  if (canSplitOff) {
    if (targets.length > 0) targets.push(MENU_SEPARATOR);
    targets.push({ label: 'Neue Arbeit', onSelect: () => onMoveToArbeit(NEW_ARBEIT) });
  }
  const items: MenuEntry[] = [
    {
      label: 'Links drehen',
      icon: 'rotate-left',
      disabled: locked,
      onSelect: () => onRotate('counterclockwise', 'menu'),
    },
    {
      label: 'Rechts drehen',
      icon: 'rotate-right',
      disabled: locked,
      onSelect: () => onRotate('clockwise', 'menu'),
    },
    MENU_SEPARATOR,
    {
      label: 'Nach vorn',
      icon: 'arrow-left',
      disabled: locked || index === 0,
      onSelect: () => onMove(index - 1),
    },
    {
      label: 'Nach hinten',
      icon: 'arrow-right',
      disabled: locked || index === count - 1,
      onSelect: () => onMove(index + 1),
    },
    { label: 'In andere Arbeit', disabled: locked || targets.length === 0, items: targets },
    { label: 'Ab hier neue Arbeit', disabled: locked || index === 0, onSelect: onSplitHere },
    MENU_SEPARATOR,
    { label: 'Entfernen', icon: 'trash', danger: true, disabled: locked, onSelect: onRemove },
  ];

  const className = ['thumb', dragging && 'is-dragging', dropTarget && 'is-drop-target']
    .filter(Boolean)
    .join(' ');

  return (
    <li
      className={className}
      data-page-id={page.id}
      draggable={!locked}
      onDragStart={onDragStart}
      onDragEnd={() => setDragging(false)}
      onDragOver={onDragOver}
      onDragLeave={() => setDropTarget(false)}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="thumb-open"
        aria-label={`${name} vergrößern`}
        title={page.label}
        onClick={onOpen}
      >
        <span className="thumb-stage">
          <img src={page.thumbnailUrl} alt="" style={imageStyle} draggable={false} />
        </span>
        <span className="thumb-number">{number}</span>
      </button>
      <div className="thumb-actions">
        <IconButton
          label={`${name} drehen`}
          icon="rotate-right"
          tooltip="none"
          data-action="rotate"
          disabled={locked}
          onClick={() => onRotate('clockwise', 'button')}
        />
        <Menu label={`Weitere Aktionen für ${name}`} tooltip="none" items={items} align="start" />
      </div>
    </li>
  );
}
