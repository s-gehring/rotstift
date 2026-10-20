import type { Arbeit } from '../import/arbeiten.ts';
import type { ArbeitPosition, Route } from './types.ts';

export const KLASSE: Route = { view: 'klasse' };

export function resolveRoute(route: Route, arbeiten: readonly Arbeit[]): Route {
  if (route.view === 'klasse') return route;
  return arbeiten.some((arbeit) => arbeit.id === route.arbeitId) ? route : KLASSE;
}

export function routePosition(route: Route, arbeiten: readonly Arbeit[]): ArbeitPosition | null {
  if (route.view === 'klasse') return null;
  const index = arbeiten.findIndex((arbeit) => arbeit.id === route.arbeitId);
  return index < 0 ? null : { index, total: arbeiten.length };
}

export function stepRoute(route: Route, arbeiten: readonly Arbeit[], delta: number): Route {
  const position = routePosition(route, arbeiten);
  if (position === null) return resolveRoute(route, arbeiten);
  const target = arbeiten[Math.min(arbeiten.length - 1, Math.max(0, position.index + delta))];
  return target === undefined ? KLASSE : { view: 'arbeit', arbeitId: target.id };
}
