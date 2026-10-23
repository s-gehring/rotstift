import { useMemo, useState, type KeyboardEvent } from 'react';
import type { CorrectionProfile } from '../annotations/profile.ts';
import type { Transcript } from '../annotations/transcript.ts';
import type { ReadingHint } from '../correction/uncertain-reading.ts';
import { layoutHints, markText, type HintSpot } from './hint-layout.ts';
import { layoutOverlay, type PageComment } from './layout.ts';
import type { TextLocator } from './locator.ts';
import {
  INK_COLOR,
  INK_OPACITY,
  type OverlayItem,
  type PageMargins,
  type PageSize,
} from './model.ts';
import './overlay.css';

export interface AnnotatedPageProps {
  readonly imageUrl: string;
  readonly size: PageSize;
  readonly transcript: Transcript;
  readonly profile: CorrectionProfile;
  readonly locator?: TextLocator;
  readonly alt?: string;
  readonly className?: string;
  readonly hints?: readonly ReadingHint[];
  readonly comments?: readonly PageComment[];
  readonly summary?: string | null;
  readonly margins?: PageMargins;
  readonly activeMark?: string | null;
  readonly onMarkHover?: (key: string | null) => void;
  readonly onMarkSelect?: (key: string) => void;
  readonly activeHint?: number | null;
  readonly onHintHover?: (index: number | null) => void;
  readonly onHintSelect?: (index: number) => void;
}

const HINT_COLOR = '#5f6368';

export function markKey(line: number, mark: number): string {
  return `${line}:${mark}`;
}

interface MarkGroup {
  readonly key: string;
  readonly items: OverlayItem[];
}

function groupByMark(items: readonly OverlayItem[]): (MarkGroup | OverlayItem)[] {
  const groups: (MarkGroup | OverlayItem)[] = [];
  const byKey = new Map<string, MarkGroup>();
  for (const item of items) {
    if (item.mark === null) {
      groups.push(item);
      continue;
    }
    const key = markKey(item.line, item.mark);
    let group = byKey.get(key);
    if (group === undefined) {
      group = { key, items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

export function AnnotatedPage({
  imageUrl,
  size,
  transcript,
  profile,
  locator,
  alt = '',
  className,
  hints,
  comments,
  summary = null,
  margins,
  activeMark = null,
  onMarkHover,
  onMarkSelect,
  activeHint = null,
  onHintHover,
  onHintSelect,
}: AnnotatedPageProps) {
  const [notes, setNotes] = useState(comments);
  if (notes !== comments && JSON.stringify(notes) !== JSON.stringify(comments)) setNotes(comments);
  const model = useMemo(
    () =>
      layoutOverlay(transcript, {
        page: size,
        profile,
        ...(locator ? { locator } : {}),
        ...(notes && { comments: notes }),
        summary,
        ...(margins && { margins }),
      }),
    [transcript, size, profile, locator, notes, summary, margins],
  );
  const groups = useMemo(() => groupByMark(model.items), [model]);
  const interactive = onMarkHover !== undefined || onMarkSelect !== undefined;
  return (
    <div
      className={className === undefined ? 'annotated-page' : `annotated-page ${className}`}
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
      data-active={activeMark ?? undefined}
    >
      <img className="annotated-page__image" src={imageUrl} alt={alt} draggable={false} />
      <svg
        className="annotated-page__overlay"
        viewBox={`0 0 ${size.width} ${size.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Korrekturen"
        data-skipped-lines={model.skippedLines.join(',')}
      >
        <g
          fill={INK_COLOR}
          stroke="none"
          opacity={INK_OPACITY}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {groups.map((group, index) =>
            !('items' in group) ? (
              <OverlayElement key={index} item={group} />
            ) : (
              <g
                key={group.key}
                className={
                  group.key === activeMark
                    ? 'annotated-page__mark is-active'
                    : 'annotated-page__mark'
                }
                data-mark-key={group.key}
                {...(interactive && {
                  'data-interactive': true,
                  onPointerEnter: () => onMarkHover?.(group.key),
                  onPointerLeave: () => onMarkHover?.(null),
                  onClick: () => onMarkSelect?.(group.key),
                })}
              >
                {group.items.map((item, position) => (
                  <OverlayElement key={position} item={item} hitArea={interactive} />
                ))}
              </g>
            ),
          )}
        </g>
      </svg>
      {hints !== undefined && hints.length > 0 && (
        <HintLayer
          size={size}
          transcript={transcript}
          hints={hints}
          active={activeHint}
          {...(locator && { locator })}
          {...(onHintHover && { onHover: onHintHover })}
          {...(onHintSelect && { onSelect: onHintSelect })}
        />
      )}
    </div>
  );
}

function HintLayer({
  size,
  transcript,
  hints,
  locator,
  active,
  onHover,
  onSelect,
}: {
  readonly size: PageSize;
  readonly transcript: Transcript;
  readonly hints: readonly ReadingHint[];
  readonly locator?: TextLocator;
  readonly active: number | null;
  readonly onHover?: (index: number | null) => void;
  readonly onSelect?: (index: number) => void;
}) {
  const spots = useMemo(
    () => layoutHints(transcript, hints, locator).filter((spot) => spot.status === 'open'),
    [transcript, hints, locator],
  );
  const [focused, setFocused] = useState<number | null>(null);
  return (
    <svg
      className="annotated-page__hints"
      viewBox={`0 0 ${size.width} ${size.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label="Unsicher gelesene Stellen"
    >
      {spots.map((spot) => (
        <HintElement
          key={spot.index}
          spot={spot}
          selected={active === spot.index || focused === spot.index}
          onFocus={(on) => setFocused(on ? spot.index : null)}
          onHover={(on) => onHover?.(on ? spot.index : null)}
          onSelect={() => onSelect?.(spot.index)}
        />
      ))}
    </svg>
  );
}

function HintElement({
  spot,
  selected,
  onFocus,
  onHover,
  onSelect,
}: {
  readonly spot: HintSpot;
  readonly selected: boolean;
  readonly onFocus: (focused: boolean) => void;
  readonly onHover: (hovered: boolean) => void;
  readonly onSelect: () => void;
}) {
  const stroke = Math.max(1.5, spot.height * 0.05);
  const fontSize = Math.max(10, spot.height * 0.55);
  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelect();
  };
  return (
    <g
      className="hint-spot"
      role="button"
      tabIndex={0}
      aria-label={`Unsicher gelesen: ${markText(spot.mark)}`}
      data-status={spot.status}
      data-hint={spot.index}
      data-selected={selected || undefined}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onFocus={() => onFocus(true)}
      onBlur={() => onFocus(false)}
    >
      <rect
        className="hint-spot__area"
        x={spot.x}
        y={spot.y}
        width={spot.width}
        height={spot.height}
        fill="transparent"
      />
      <line
        x1={spot.x}
        x2={spot.x + spot.width}
        y1={spot.underline}
        y2={spot.underline}
        stroke={HINT_COLOR}
        strokeWidth={selected ? stroke * 1.6 : stroke}
        strokeDasharray={`${stroke} ${stroke * 2}`}
        strokeLinecap="round"
      />
      {selected && (
        <text
          className="hint-spot__suggestion"
          x={spot.x}
          y={spot.y - fontSize * 0.2}
          fontSize={fontSize}
          fill={HINT_COLOR}
          stroke="white"
          strokeWidth={fontSize * 0.15}
          paintOrder="stroke"
          aria-hidden="true"
        >
          {markText(spot.mark)}
        </text>
      )}
    </g>
  );
}

function OverlayElement({
  item,
  hitArea = false,
}: {
  readonly item: OverlayItem;
  readonly hitArea?: boolean;
}) {
  if (item.kind === 'stroke') {
    return (
      <>
        {hitArea && (
          <path
            className="annotated-page__hit"
            d={item.d}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(item.width * 8, 24)}
          />
        )}
        <path
          d={item.d}
          fill="none"
          stroke={INK_COLOR}
          strokeWidth={item.width}
          data-role={item.role}
          data-line={item.line}
          data-mark={item.mark}
        >
          <title>{item.title}</title>
        </path>
      </>
    );
  }
  return (
    <text
      x={item.x}
      y={item.y}
      fontSize={item.size}
      textAnchor={item.anchor}
      transform={`rotate(${item.rotate} ${item.x} ${item.y})`}
      data-role={item.role}
      data-line={item.line}
      data-mark={item.mark ?? undefined}
    >
      {item.text}
      <title>{item.title}</title>
    </text>
  );
}
