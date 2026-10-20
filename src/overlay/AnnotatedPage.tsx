import { useMemo, useState, type KeyboardEvent } from 'react';
import type { CorrectionProfile } from '../annotations/profile.ts';
import type { Transcript } from '../annotations/transcript.ts';
import type { ReadingHint } from '../correction/uncertain-reading.ts';
import { layoutHints, markText, type HintSpot } from './hint-layout.ts';
import { layoutOverlay } from './layout.ts';
import type { TextLocator } from './locator.ts';
import { INK_COLOR, INK_OPACITY, type OverlayItem, type PageSize } from './model.ts';
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
  readonly onHint?: (index: number) => void;
}

const HINT_COLOR = '#5f6368';

export function AnnotatedPage({
  imageUrl,
  size,
  transcript,
  profile,
  locator,
  alt = '',
  className,
  hints,
  onHint,
}: AnnotatedPageProps) {
  const model = useMemo(
    () => layoutOverlay(transcript, { page: size, profile, ...(locator ? { locator } : {}) }),
    [transcript, size, profile, locator],
  );
  return (
    <div
      className={className === undefined ? 'annotated-page' : `annotated-page ${className}`}
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
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
          {model.items.map((item, index) => (
            <OverlayElement key={index} item={item} />
          ))}
        </g>
      </svg>
      {hints !== undefined && hints.length > 0 && (
        <HintLayer
          size={size}
          transcript={transcript}
          hints={hints}
          {...(locator && { locator })}
          {...(onHint && { onHint })}
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
  onHint,
}: {
  readonly size: PageSize;
  readonly transcript: Transcript;
  readonly hints: readonly ReadingHint[];
  readonly locator?: TextLocator;
  readonly onHint?: (index: number) => void;
}) {
  const spots = useMemo(
    () => layoutHints(transcript, hints, locator),
    [transcript, hints, locator],
  );
  const [selected, setSelected] = useState<number | null>(null);
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
          selected={selected === spot.index}
          onSelect={(on) => setSelected(on ? spot.index : null)}
          onCycle={() => onHint?.(spot.index)}
        />
      ))}
    </svg>
  );
}

function hintLabel(spot: HintSpot): string {
  const state = spot.status === 'open' ? 'Unsicher gelesen' : 'Als Fehler übernommen';
  const action = spot.status === 'open' ? 'Als Fehler übernehmen' : 'Verwerfen';
  return `${state}: ${markText(spot.mark)}. ${action}`;
}

function HintElement({
  spot,
  selected,
  onSelect,
  onCycle,
}: {
  readonly spot: HintSpot;
  readonly selected: boolean;
  readonly onSelect: (selected: boolean) => void;
  readonly onCycle: () => void;
}) {
  const stroke = Math.max(1.5, spot.height * 0.05);
  const fontSize = Math.max(10, spot.height * 0.55);
  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onCycle();
  };
  return (
    <g
      className="hint-spot"
      role="button"
      tabIndex={0}
      aria-label={hintLabel(spot)}
      data-status={spot.status}
      data-hint={spot.index}
      onClick={onCycle}
      onKeyDown={onKeyDown}
      onFocus={() => onSelect(true)}
      onBlur={() => onSelect(false)}
      onMouseEnter={() => onSelect(true)}
      onMouseLeave={() => onSelect(false)}
    >
      <rect
        className="hint-spot__area"
        x={spot.x}
        y={spot.y}
        width={spot.width}
        height={spot.height}
        fill="transparent"
      />
      {spot.status === 'open' && (
        <line
          x1={spot.x}
          x2={spot.x + spot.width}
          y1={spot.underline}
          y2={spot.underline}
          stroke={HINT_COLOR}
          strokeWidth={stroke}
          strokeDasharray={`${stroke} ${stroke * 2}`}
          strokeLinecap="round"
        />
      )}
      {selected && spot.status === 'open' && (
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

function OverlayElement({ item }: { readonly item: OverlayItem }) {
  if (item.kind === 'stroke') {
    return (
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
