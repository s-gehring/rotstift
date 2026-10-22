import { confirmReading } from '../correction/second-reading.ts';
import type { PageTranscriber } from './transcriber.ts';

export function withSecondReading<T extends PageTranscriber>(
  primary: T,
  second: PageTranscriber,
): T {
  return {
    ...primary,
    async recover() {
      await primary.recover?.();
      await second.recover?.();
    },
    async transcribe(png, signal, onPhase) {
      const first = await primary.transcribe(png, signal, onPhase);
      if (!first.ok || first.reading === undefined) return first;
      const other = await second.transcribe(png, signal, onPhase);
      if (!other.ok) return other.error.kind === 'cancelled' ? other : first;
      return {
        ...first,
        startupMs: (first.startupMs ?? 0) + (other.startupMs ?? 0),
        reading: confirmReading(first.reading, other.lines),
      };
    },
  };
}
