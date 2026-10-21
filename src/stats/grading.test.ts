import { describe, expect, it } from 'vitest';
import {
  activeLimits,
  defaultGrading,
  formatLimit,
  gradeFor,
  gradeOf,
  GRADES,
  gradeText,
  misorderedLimits,
  parseLimit,
  type Grading,
  type Limits,
} from './grading.ts';

function grades(limits: Limits): Grading {
  const base = defaultGrading();
  return { ...base, enabled: true, limits: { ...base.limits, grades: limits } };
}

function points(limits: Limits): Grading {
  const base = defaultGrading();
  return { ...base, enabled: true, scale: 'points', limits: { ...base.limits, points: limits } };
}

const table = grades([1, 2, 3, 4, 5]);

describe('defaultGrading', () => {
  it('is off with empty tables for grades 1 to 6 and points 15 to 0', () => {
    const grading = defaultGrading();
    expect(grading.enabled).toBe(false);
    expect(grading.limits.grades).toEqual([null, null, null, null, null]);
    expect(grading.limits.points).toHaveLength(15);
    expect(GRADES.points[0]).toBe('15');
    expect(GRADES.points.at(-1)).toBe('0');
  });

  it('gives no grade while off or empty', () => {
    expect(gradeOf(0, defaultGrading())).toBeNull();
    expect(gradeOf(0, { ...defaultGrading(), enabled: true })).toBeNull();
    expect(gradeOf(0, { ...table, enabled: false })).toBeNull();
  });
});

describe('gradeOf', () => {
  it.each([
    [0, '1'],
    [1, '1'],
    [1.04, '1'],
    [1.05, '2'],
    [1.1, '2'],
    [2, '2'],
    [4.99, '5'],
    [5, '5'],
    [5.01, '5'],
    [5.06, '6'],
    [42, '6'],
  ])('gives quotient %d the grade %s, the limit itself included', (quotient, grade) => {
    expect(gradeOf(quotient, table)).toBe(grade);
  });

  it('compares the quotient as shown with one decimal', () => {
    expect(gradeOf((3 / 100) * 100, grades([3, null, null, null, null]))).toBe('1');
    expect(gradeOf((7 / 700) * 100, grades([1, null, null, null, null]))).toBe('1');
    expect(gradeOf(1.149, grades([1.1, null, null, null, null]))).toBe('1');
  });

  it('skips grades without a limit', () => {
    const gaps = grades([1, null, 3, null, null]);
    expect(gradeOf(1, gaps)).toBe('1');
    expect(gradeOf(1.1, gaps)).toBe('3');
    expect(gradeOf(3.1, gaps)).toBe('6');
  });

  it('gives no grade when the limits are not ascending', () => {
    expect(gradeOf(1, grades([2, 1, null, null, null]))).toBeNull();
    expect(gradeOf(1, grades([2, 2, null, null, null]))).toBeNull();
  });

  it('grades in points from 15 to 0', () => {
    const scale = points(Array.from({ length: 15 }, (_, index) => (index + 1) * 0.5));
    expect(gradeOf(0, scale)).toBe('15');
    expect(gradeOf(0.5, scale)).toBe('15');
    expect(gradeOf(0.6, scale)).toBe('14');
    expect(gradeOf(7.5, scale)).toBe('1');
    expect(gradeOf(7.6, scale)).toBe('0');
  });
});

describe('gradeFor', () => {
  it('gives no grade for an empty Arbeit', () => {
    expect(gradeFor({ words: 0, weighted: 0, quotient: 0 }, table)).toBeNull();
    expect(gradeFor(null, table)).toBeNull();
  });

  it('grades the weighted quotient', () => {
    expect(gradeFor({ words: 200, weighted: 4, quotient: 2 }, table)).toBe('2');
  });
});

describe('limits', () => {
  it('parses German and English decimals with at most one digit after the separator', () => {
    expect(parseLimit('2,5')).toBe(2.5);
    expect(parseLimit(' 3.0 ')).toBe(3);
    expect(parseLimit('')).toBeNull();
    expect(parseLimit('2,55')).toBeUndefined();
    expect(parseLimit('-1')).toBeUndefined();
    expect(parseLimit('abc')).toBeUndefined();
    expect(parseLimit('101')).toBeUndefined();
  });

  it('formats a limit with one decimal', () => {
    expect(formatLimit(3)).toBe('3,0');
    expect(formatLimit(null)).toBe('');
  });

  it('names the limits that are not above an earlier one', () => {
    expect([...misorderedLimits([1, null, 0.5, 2, 2])]).toEqual([2, 4]);
    expect(activeLimits(grades([1, null, 0.5, null, null]))).toBeNull();
  });

  it('writes grades and points', () => {
    expect(gradeText('2', 'grades')).toBe('Note 2');
    expect(gradeText('1', 'points')).toBe('1 Punkt');
    expect(gradeText('11', 'points')).toBe('11 Punkte');
  });
});
