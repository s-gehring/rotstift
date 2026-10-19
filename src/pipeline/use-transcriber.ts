import { useEffect, useState } from 'react';
import { browserEnvironment } from './environment.ts';
import { resolveTranscriber, type ModelAvailability } from './provider.ts';
import type { TranscriberStatus } from './transcriber.ts';

export function useTranscriber(availability: ModelAvailability | null): TranscriberStatus | null {
  const [status, setStatus] = useState<TranscriberStatus | null>(null);

  useEffect(() => {
    let current = true;
    resolveTranscriber(browserEnvironment(), availability).then(
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
  }, [availability]);

  return status;
}
