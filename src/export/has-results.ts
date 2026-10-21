import type { Arbeit } from '../import/arbeiten.ts';
import type { PageEntry } from '../pipeline/runner.ts';

export function hasResults(
  arbeiten: readonly Arbeit[],
  entries: Readonly<Record<string, PageEntry>>,
): boolean {
  return arbeiten.some((arbeit) => arbeit.pages.some((page) => entries[page.id]?.hasTranscript));
}
