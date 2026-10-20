import { formatMegabytes } from './format.ts';
import type { ModelStatus } from './types.ts';

function checking(status: ModelStatus | null): status is ModelStatus {
  return status?.state === 'verifying' && status.totalBytes > 0;
}

export function checkText(files: string, status: ModelStatus | null): string {
  const text = `Rotstift prüft einmalig, ob ${files} vollständig und unbeschädigt sind.`;
  if (!checking(status)) return text;
  return `${text} ${formatMegabytes(status.downloadedBytes)} von ${formatMegabytes(status.totalBytes)} geprüft.`;
}

export function CheckProgress({
  status,
  label,
}: {
  readonly status: ModelStatus | null;
  readonly label: string;
}) {
  if (!checking(status)) return null;
  return (
    <progress
      className="check-progress"
      value={status.downloadedBytes}
      max={status.totalBytes}
      aria-label={label}
    />
  );
}
