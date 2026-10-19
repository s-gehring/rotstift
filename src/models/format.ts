import { formatRemaining } from '../pipeline/progress.ts';
import type { DownloadError } from './types.ts';

const MEGABYTE = 1_000_000;
const GIGABYTE = 1_000_000_000;
const GIBIBYTE = 1024 ** 3;

const integer = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatMegabytes(bytes: number): string {
  return `${integer.format(Math.round(bytes / MEGABYTE))} MB`;
}

export function formatSize(bytes: number): string {
  return bytes >= GIGABYTE ? `${oneDecimal.format(bytes / GIGABYTE)} GB` : formatMegabytes(bytes);
}

export function formatMemory(bytes: number): string {
  return `${oneDecimal.format(bytes / GIBIBYTE)} GB`;
}

export interface Sample {
  readonly at: number;
  readonly bytes: number;
}

const SPEED_WINDOW_MS = 15_000;
const MIN_SPAN_MS = 2_000;

export function pushSample(samples: readonly Sample[], sample: Sample): Sample[] {
  const kept = samples.filter(
    (existing) => sample.at - existing.at <= SPEED_WINDOW_MS && existing.bytes <= sample.bytes,
  );
  return [...kept, sample];
}

export function remainingText(
  samples: readonly Sample[],
  downloaded: number,
  total: number,
): string | null {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === undefined || last === undefined) return null;
  const span = last.at - first.at;
  const gained = last.bytes - first.bytes;
  if (span < MIN_SPAN_MS || gained <= 0) return null;
  return formatRemaining(((total - downloaded) / gained) * span);
}

export function describeDownloadError(error: DownloadError): string {
  switch (error.kind) {
    case 'insufficientDisk':
      return `Zu wenig freier Speicherplatz: Benötigt werden ${formatSize(error.detail.needed)}, frei sind ${formatSize(error.detail.available)}. Bitte Platz schaffen und erneut versuchen.`;
    case 'network':
      return 'Die Verbindung zum Download-Server ist abgebrochen. Bitte die Internetverbindung prüfen und erneut versuchen. Der bisherige Fortschritt bleibt erhalten.';
    case 'incomplete':
      return 'Der Download wurde vorzeitig beendet. Bitte erneut versuchen, der bisherige Fortschritt bleibt erhalten.';
    case 'http':
      return `Der Download-Server hat den Download abgelehnt (Fehler ${error.detail.status}). Bitte später erneut versuchen.`;
    case 'hashMismatch':
    case 'sizeMismatch':
      return 'Die heruntergeladene Datei ist beschädigt oder stimmt nicht mit der erwarteten Datei überein. Sie wurde verworfen. Bitte erneut versuchen.';
    case 'notAllowed':
      return 'Der Download wurde blockiert, weil die Adresse nicht zu den erlaubten Quellen gehört.';
    case 'busy':
      return 'Es läuft bereits ein Download für dieses Modell.';
    case 'cancelled':
      return 'Der Download wurde abgebrochen.';
    case 'unknownModel':
      return 'Dieses Modell ist in dieser Version nicht bekannt.';
    case 'io':
      return 'Die Modelldatei konnte nicht gespeichert oder gelesen werden. Bitte prüfen, ob genug Speicherplatz frei ist und der Ordner beschreibbar ist.';
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}

export function describeImport(
  imported: readonly string[],
  unmatched: readonly string[],
  expected: number,
): string {
  if (imported.length === 0) {
    return 'Keine der gewählten Dateien gehört zu diesem Modell. Bitte genau die beiden Dateien auswählen, die auf der Download-Seite des Modells stehen.';
  }
  const parts: string[] = [];
  if (imported.length < expected)
    parts.push(`Übernommen: ${imported.length} von ${expected} Dateien.`);
  if (unmatched.length > 0) parts.push(`Nicht passend und ignoriert: ${unmatched.join(', ')}.`);
  return parts.join(' ');
}
