import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CorrectorStatus } from '../correction/provider.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import { createLayoutLocator, observeLocate } from '../layout/layout-client.ts';
import { browserDiagnostics, logLayout } from '../pipeline/diagnostics.ts';
import type { Runner } from '../pipeline/runner.ts';
import { loadPageImage } from './page-image.ts';
import { createReviewFlow } from './review-flow.ts';

export function useReview(
  runner: Runner,
  pages: readonly ImportPage[],
  corrector: CorrectorStatus | null,
  reviewer: CorrectorStatus | null,
  arbeiten: readonly Arbeit[] = [],
) {
  const [{ flow, locator }] = useState(() => {
    const created = createLayoutLocator();
    const diagnostics = browserDiagnostics();
    return {
      locator: created,
      flow: createReviewFlow({
        transcription: runner,
        locator: observeLocate(created, (counts, durationMs) => {
          logLayout(diagnostics, counts === null ? null : { ...counts, durationMs });
        }),
        loadImage: loadPageImage,
        logReview: (entry) => diagnostics.log('content_review', { ...entry }),
      }),
    };
  });
  const state = useSyncExternalStore(flow.subscribe, flow.getState);

  useEffect(() => {
    if (corrector?.state === 'ready') flow.setCorrector(corrector.corrector, corrector.preview);
    else flow.setCorrector(null);
  }, [flow, corrector]);

  useEffect(() => {
    flow.setReviewer(reviewer?.state === 'ready' ? reviewer.corrector : null);
  }, [flow, reviewer]);

  useEffect(() => {
    flow.prune(new Set(pages.map((page) => page.id)), new Set(arbeiten.map((arbeit) => arbeit.id)));
  }, [flow, pages, arbeiten]);

  useEffect(
    () => () => {
      flow.dispose();
      locator.dispose();
    },
    [flow, locator],
  );

  return { flow, state };
}

export type Review = ReturnType<typeof useReview>;
