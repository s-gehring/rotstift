import { useSyncExternalStore } from 'react';

export type Display = 'corrected' | 'original';

let display: Display = 'corrected';
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function setDisplay(next: Display) {
  if (next === display) return;
  display = next;
  for (const listener of listeners) listener();
}

export function useDisplay(): Display {
  return useSyncExternalStore(subscribe, () => display);
}
