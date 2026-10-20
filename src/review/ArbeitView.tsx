import { useEffect, useId } from 'react';
import { useApp } from '../app/app-context.tsx';
import { ResultsView } from '../results/ResultsView.tsx';
import { Button } from '../ui/Button.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { ReviewView } from './ReviewView.tsx';

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export function ArbeitView({ arbeitId }: { readonly arbeitId: string }) {
  const { importState, navigation, work, run } = useApp();
  const { back, next, prev, position } = navigation;
  const headingId = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTyping(event.target)) return;
      if (document.querySelector('dialog[open]') !== null) return;
      if (event.key === 'ArrowLeft') prev();
      else if (event.key === 'ArrowRight') next();
      else if (event.key === 'Escape') back();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [back, next, prev]);

  const arbeit = importState.arbeiten.find((candidate) => candidate.id === arbeitId);
  if (arbeit === undefined) return null;
  const reviewed = arbeit.pages.some((page) => work.review.state.pages[page.id] !== undefined);

  return (
    <section className="arbeit-view" aria-labelledby={headingId}>
      <div className="arbeit-view-head">
        <Button variant="quiet" icon="chevron-left" onClick={back}>
          Klasse
        </Button>
        <h1 id={headingId}>{arbeit.name}</h1>
        {position !== null && (
          <span className="arbeit-view-position">
            <IconButton
              label="Vorherige Arbeit"
              icon="chevron-left"
              disabled={position.index === 0}
              onClick={prev}
            />
            <span>
              {position.index + 1} von {position.total}
            </span>
            <IconButton
              label="Nächste Arbeit"
              icon="chevron-right"
              disabled={position.index === position.total - 1}
              onClick={next}
            />
          </span>
        )}
      </div>
      {reviewed && (
        <ReviewView
          arbeiten={importState.arbeiten}
          arbeitId={arbeit.id}
          flow={work.review.flow}
          state={work.review.state}
          entries={work.count.state.entries}
          canRetry={work.canRetryReview}
        />
      )}
      <ResultsView
        arbeiten={[arbeit]}
        count={work.count}
        canRetry={work.canRetryCount}
        locked={run.running}
      />
    </section>
  );
}
