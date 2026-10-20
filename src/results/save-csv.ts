import { saveFile, type Invoke, type SaveOutcome } from '../export/save-file.ts';

export type { Invoke, SaveOutcome };

export function saveCsv(
  content: string,
  suggestedName: string,
  invoke?: Invoke | null,
): Promise<SaveOutcome> {
  return saveFile('csv', new TextEncoder().encode(content), suggestedName, invoke);
}
