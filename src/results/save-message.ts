import type { SaveOutcome } from '../export/save-file.ts';

export function saveMessage(outcome: SaveOutcome, extension: 'csv' | 'pdf'): string | null {
  switch (outcome.state) {
    case 'saved':
      return `Gespeichert als „${outcome.fileName}“.`;
    case 'exists':
      return `Die Datei „${outcome.fileName}“ gibt es bereits und wurde nicht überschrieben. Bitte den Dateinamen mit „.${extension}“ eingeben oder einen anderen Namen wählen.`;
    case 'unavailable':
      return 'Speichern ist nur in der Rotstift-App möglich, nicht im Browser.';
    case 'failed':
      return extension === 'pdf'
        ? 'Das PDF konnte nicht erstellt oder gespeichert werden.'
        : 'Speichern war nicht möglich.';
    case 'cancelled':
      return null;
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}
