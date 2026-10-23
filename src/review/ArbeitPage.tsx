import { useEffect, useRef, useState } from 'react';
import type { CorrectionProfile } from '../annotations/profile.ts';
import { rotatedSize } from '../import/pages.ts';
import { AnnotatedPage } from '../overlay/AnnotatedPage.tsx';
import { Button } from '../ui/Button.tsx';
import { Icon } from '../ui/icons.tsx';
import { Menu, type MenuEntry } from '../ui/Menu.tsx';
import type { PageModel } from './arbeit-model.ts';
import type { Display } from './display.ts';
import { usePageImage } from './use-page-image.ts';

const ACTIVITY_TEXT = {
  reading: 'wird gelesen …',
  correcting: 'wird korrigiert …',
} as const;

function useNearViewport(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current;
    if (near || element === null) return undefined;
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) setNear(true);
      },
      { rootMargin: '100% 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near];
}

export interface ArbeitPageProps {
  readonly model: PageModel;
  readonly arbeitName: string;
  readonly profile: CorrectionProfile | null;
  readonly display: Display;
  readonly menu: readonly MenuEntry[];
  readonly retry: { readonly hint: string | null; readonly onRetry: () => void };
  readonly activeMark: string | null;
  readonly activeHint: number | null;
  readonly onMarkHover: (key: string | null) => void;
  readonly onMarkSelect: (key: string) => void;
  readonly onHintHover: (index: number | null) => void;
  readonly onHintSelect: (index: number) => void;
}

export function ArbeitPage({
  model,
  arbeitName,
  profile,
  display,
  menu,
  retry,
  activeMark,
  activeHint,
  onMarkHover,
  onMarkSelect,
  onHintHover,
  onHintSelect,
}: ArbeitPageProps) {
  const { page, position, correction, image } = model;
  const [paper, near] = useNearViewport();
  const url = usePageImage(page, image, near);
  const size = image ?? rotatedSize(page);
  const alt = `Seite ${position} von ${arbeitName}`;
  const annotate =
    correction !== null && image !== null && profile !== null && display === 'corrected';
  return (
    <li className="sheet" data-page={page.id}>
      <div className="sheet-head">
        <span className="sheet-label">Seite {position}</span>
        {model.activity !== null && (
          <span className="sheet-activity">{ACTIVITY_TEXT[model.activity]}</span>
        )}
        {model.warning !== null && (
          <span
            className="sheet-warning"
            role="img"
            aria-label={model.warning}
            title={model.warning}
          >
            <Icon name="alert" />
          </span>
        )}
        <Menu label={`Seite ${position}: Weitere Aktionen`} items={menu} className="sheet-menu" />
      </div>
      {model.problem !== null && (
        <p className="sheet-problem">
          <Icon name="alert" />
          <span>{model.problem}</span>
          <Button
            variant="quiet"
            disabled={retry.hint !== null}
            title={retry.hint ?? undefined}
            onClick={retry.onRetry}
          >
            Erneut versuchen
          </Button>
        </p>
      )}
      <div
        ref={paper}
        className="sheet-paper"
        style={{ aspectRatio: `${size.width} / ${size.height}` }}
      >
        {url !== null &&
          (annotate ? (
            <AnnotatedPage
              imageUrl={url}
              size={image}
              transcript={correction.transcript}
              profile={profile}
              alt={`${alt}, korrigiert`}
              hints={correction.readingHints}
              comments={correction.comments}
              summary={correction.summary}
              {...(correction.margins && { margins: correction.margins })}
              activeMark={activeMark}
              onMarkHover={onMarkHover}
              onMarkSelect={onMarkSelect}
              activeHint={activeHint}
              onHintHover={onHintHover}
              onHintSelect={onHintSelect}
            />
          ) : (
            <img src={url} alt={alt} draggable={false} />
          ))}
      </div>
    </li>
  );
}
