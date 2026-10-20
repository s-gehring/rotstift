import type { SaveOutcome } from '../export/save-file.ts';

function failureMessage(
  reason: 'tooLarge' | 'build' | undefined,
  extension: 'csv' | 'pdf',
): string {
  if (reason === 'tooLarge') {
    return extension === 'pdf'
      ? 'Das PDF ist zu groß zum Speichern (mehr als 200 MB). Bitte weniger Arbeiten auf einmal speichern.'
      : 'Die Tabelle ist zu groß zum Speichern (mehr als 8 MB).';
  }
  if (reason === 'build') {
    return 'Das PDF konnte nicht erstellt werden. Bitte die Seiten prüfen und es erneut versuchen.';
  }
  return extension === 'pdf'
    ? 'Das PDF konnte nicht gespeichert werden.'
    : 'Speichern war nicht möglich.';
}

export function saveMessage(outcome: SaveOutcome, extension: 'csv' | 'pdf'): string | null {
  switch (outcome.state) {
    case 'saved':
      return `Gespeichert als „${outcome.fileName}“.`;
    case 'exists':
      return `Die Datei „${outcome.fileName}“ gibt es bereits und wurde nicht überschrieben. Bitte den Dateinamen mit „.${extension}“ eingeben oder einen anderen Namen wählen.`;
    case 'unavailable':
      return 'Speichern ist nur in der Rotstift-App möglich, nicht im Browser.';
    case 'failed':
      return failureMessage(outcome.reason, extension);
    case 'cancelled':
      return null;
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}
