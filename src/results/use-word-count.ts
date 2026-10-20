import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ImportPage } from '../import/pages.ts';
import { renderPageToPng } from '../import/render-page.ts';
import { createRunner } from '../pipeline/runner.ts';
import type { TranscriberStatus } from '../pipeline/transcriber.ts';

export function useWordCount(pages: readonly ImportPage[], status: TranscriberStatus | null) {
  const [runner] = useState(() => createRunner({ render: renderPageToPng }));
  const state = useSyncExternalStore(runner.subscribe, runner.getState);

  useEffect(() => {
    runner.setTranscriber(status?.state === 'ready' ? status.transcriber : null);
  }, [runner, status]);

  useEffect(() => {
    runner.setPages(pages);
  }, [runner, pages]);

  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) runner.dispose();
      });
    };
  }, [runner]);

  return { runner, state };
}

export type WordCount = ReturnType<typeof useWordCount>;
