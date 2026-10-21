import { markStruck } from '../annotations/struck.ts';
import type { PageTranscriber } from './transcriber.ts';

export type StruckWordFinder = (png: Blob, lines: readonly string[]) => Promise<number[][]>;

export function withStruckWords<T extends PageTranscriber>(
  transcriber: T,
  find: StruckWordFinder,
): T {
  return {
    ...transcriber,
    async transcribe(png, signal, onPhase) {
      const result = await transcriber.transcribe(png, signal, onPhase);
      if (!result.ok || result.lines.length === 0) return result;
      const struck = await find(png, result.lines).catch(() => null);
      if (struck === null) return result;
      return {
        ...result,
        lines: result.lines.map((line, index) => markStruck(line, struck[index] ?? [])),
      };
    },
  };
}
