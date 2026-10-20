import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CorrectorStatus } from '../correction/provider.ts';
import type { ImportPage } from '../import/pages.ts';
import { createLayoutLocator } from '../layout/layout-client.ts';
import type { Runner } from '../pipeline/runner.ts';
import { loadPageImage, releasePageImage } from './page-image.ts';
import { createReviewFlow } from './review-flow.ts';

export function useReview(
  runner: Runner,
  pages: readonly ImportPage[],
  corrector: CorrectorStatus | null,
) {
  const [{ flow, locator }] = useState(() => {
    const created = createLayoutLocator();
    return {
      locator: created,
      flow: createReviewFlow({
        transcription: runner,
        locator: created,
        loadImage: loadPageImage,
        releaseImage: releasePageImage,
      }),
    };
  });
  const state = useSyncExternalStore(flow.subscribe, flow.getState);

  useEffect(() => {
    flow.setCorrector(corrector?.state === 'ready' ? corrector.corrector : null);
  }, [flow, corrector]);

  useEffect(() => {
    flow.prune(new Set(pages.map((page) => page.id)));
  }, [flow, pages]);

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
