import type { PageTranscriber } from './transcriber.ts';

export function withSecondReading<T extends PageTranscriber>(
  primary: T,
  second: PageTranscriber,
): T & { readonly secondRead: NonNullable<PageTranscriber['secondRead']> } {
  return {
    ...primary,
    async recover() {
      await primary.recover?.();
      await second.recover?.();
    },
    secondRead: (png, signal, onPhase) => second.transcribe(png, signal, onPhase),
  };
}
