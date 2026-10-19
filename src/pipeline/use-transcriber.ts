import { useEffect, useState } from 'react';
import { browserEnvironment } from './environment.ts';
import { resolveTranscriber } from './provider.ts';
import type { TranscriberStatus } from './transcriber.ts';

export function useTranscriber(): TranscriberStatus | null {
  const [status, setStatus] = useState<TranscriberStatus | null>(null);

  useEffect(() => {
    let current = true;
    resolveTranscriber(browserEnvironment()).then(
      (resolved) => {
        if (current) setStatus(resolved);
      },
      (error: unknown) => {
        if (current) {
          setStatus({
            state: 'unavailable',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, []);

  return status;
}
