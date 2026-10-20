import { useMemo } from 'react';
import type { CorrectionProfile } from '../annotations/profile.ts';
import type { Transcript } from '../annotations/transcript.ts';
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
}

export function AnnotatedPage({
  imageUrl,
  size,
  transcript,
  profile,
  locator,
  alt = '',
  className,
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
    </div>
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
