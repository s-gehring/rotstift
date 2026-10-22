export function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 10) return 'weniger als 10 Sekunden';
  if (seconds < 60) return `etwa ${Math.round(seconds / 5) * 5} Sekunden`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes === 1) return 'etwa 1 Minute';
  if (minutes < 60) return `etwa ${minutes} Minuten`;
  return `etwa ${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.`;
}
