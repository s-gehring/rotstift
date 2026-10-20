import { useState, type DragEvent } from 'react';
import { rotatedSize, type ImportPage } from './pages.ts';

const STAGE = 160;
const DRAG_TYPE = 'application/x-rotstift-page';
export const NEW_ARBEIT = 'new';

export interface MoveTarget {
  readonly id: string;
  readonly name: string;
}

interface PageCardProps {
  readonly page: ImportPage;
  readonly index: number;
  readonly count: number;
  readonly arbeitName: string;
  readonly moveTargets: readonly MoveTarget[];
  readonly canSplit: boolean;
  readonly onRotate: (direction: 'clockwise' | 'counterclockwise') => void;
  readonly onMove: (toIndex: number) => void;
  readonly onRemove: () => void;
  readonly onMoveToArbeit: (target: string) => void;
  readonly onDropPage: (draggedId: string) => void;
}

export function PageCard({
  page,
  index,
  count,
  arbeitName,
  moveTargets,
  canSplit,
  onRotate,
  onMove,
  onRemove,
  onMoveToArbeit,
  onDropPage,
}: PageCardProps) {
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);

  const number = index + 1;
  const name = `Seite ${number} von ${arbeitName}`;
  const visible = rotatedSize(page);
  const scale = Math.min(STAGE / visible.width, STAGE / visible.height);
  const imageStyle = {
    width: page.width * scale,
    height: page.height * scale,
    transform: `translate(-50%, -50%) rotate(${page.rotation}deg)`,
  };

  const onDragStart = (event: DragEvent<HTMLLIElement>) => {
    event.dataTransfer.setData(DRAG_TYPE, page.id);
    event.dataTransfer.effectAllowed = 'move';
    setDragging(true);
  };
  const onDragOver = (event: DragEvent<HTMLLIElement>) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(true);
  };
  const onDrop = (event: DragEvent<HTMLLIElement>) => {
    const draggedId = event.dataTransfer.getData(DRAG_TYPE);
    setDropTarget(false);
    if (draggedId === '') return;
    event.preventDefault();
    onDropPage(draggedId);
  };

  const className = ['page-card', dragging && 'is-dragging', dropTarget && 'is-drop-target']
    .filter(Boolean)
    .join(' ');

  return (
    <li
      className={className}
      data-page-id={page.id}
      draggable
      onDragStart={onDragStart}
      onDragEnd={() => setDragging(false)}
      onDragOver={onDragOver}
      onDragLeave={() => setDropTarget(false)}
      onDrop={onDrop}
    >
      <div className="page-stage">
        <img
          src={page.thumbnailUrl}
          alt={`${name}: ${page.label}`}
          style={imageStyle}
          draggable={false}
        />
      </div>
      <p className="page-label" title={page.label}>
        <strong>{number}</strong> · {page.label}
      </p>
      <div className="page-actions">
        <button
          type="button"
          data-action="rotate-left"
          title="Nach links drehen"
          aria-label={`${name} nach links drehen`}
          onClick={() => onRotate('counterclockwise')}
        >
          ↺
        </button>
        <button
          type="button"
          data-action="rotate-right"
          title="Nach rechts drehen"
          aria-label={`${name} nach rechts drehen`}
          onClick={() => onRotate('clockwise')}
        >
          ↻
        </button>
        <button
          type="button"
          data-action="move-earlier"
          title="Nach vorn schieben"
          aria-label={`${name} nach vorn schieben`}
          disabled={index === 0}
          onClick={() => onMove(index - 1)}
        >
          ←
        </button>
        <button
          type="button"
          data-action="move-later"
          title="Nach hinten schieben"
          aria-label={`${name} nach hinten schieben`}
          disabled={index === count - 1}
          onClick={() => onMove(index + 1)}
        >
          →
        </button>
        <button
          type="button"
          data-action="remove"
          className="danger"
          title="Seite entfernen"
          aria-label={`${name} entfernen`}
          onClick={onRemove}
        >
          ✕
        </button>
      </div>
      {(moveTargets.length > 0 || canSplit) && (
        <select
          className="page-move"
          data-action="move-arbeit"
          aria-label={`${name} in eine andere Arbeit verschieben`}
          value=""
          onChange={(event) => {
            if (event.target.value !== '') onMoveToArbeit(event.target.value);
          }}
        >
          <option value="">In andere Arbeit …</option>
          {moveTargets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.name}
            </option>
          ))}
          {canSplit && <option value={NEW_ARBEIT}>Eigene Arbeit</option>}
        </select>
      )}
    </li>
  );
}
