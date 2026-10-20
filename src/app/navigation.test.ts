import { describe, expect, it } from 'vitest';
import type { Arbeit } from '../import/arbeiten.ts';
import { page } from '../review/test-support.ts';
import { KLASSE, resolveRoute, routePosition, stepRoute } from './navigation.ts';

const arbeiten: Arbeit[] = ['ada', 'ben', 'cleo'].map((id) => ({
  id,
  name: id,
  pages: [page(`${id}-1`)],
}));

const open = (arbeitId: string) => ({ view: 'arbeit', arbeitId }) as const;

describe('navigation', () => {
  it('knows the position of the open Arbeit', () => {
    expect(routePosition(KLASSE, arbeiten)).toBeNull();
    expect(routePosition(open('ben'), arbeiten)).toEqual({ index: 1, total: 3 });
  });

  it('steps to the next and previous Arbeit and stops at the ends', () => {
    expect(stepRoute(open('ben'), arbeiten, 1)).toEqual(open('cleo'));
    expect(stepRoute(open('ben'), arbeiten, -1)).toEqual(open('ada'));
    expect(stepRoute(open('cleo'), arbeiten, 1)).toEqual(open('cleo'));
    expect(stepRoute(open('ada'), arbeiten, -1)).toEqual(open('ada'));
    expect(stepRoute(KLASSE, arbeiten, 1)).toEqual(KLASSE);
  });

  it('falls back to the class when the open Arbeit disappears', () => {
    expect(resolveRoute(open('ben'), arbeiten)).toEqual(open('ben'));
    expect(resolveRoute(open('weg'), arbeiten)).toBe(KLASSE);
    expect(stepRoute(open('weg'), arbeiten, 1)).toBe(KLASSE);
  });
});
