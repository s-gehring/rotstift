import type { WeightedStatistics } from './weighting.ts';

export type GradeScale = 'grades' | 'points';

export const GRADE_SCALES: readonly GradeScale[] = ['grades', 'points'];

export const GRADES: Readonly<Record<GradeScale, readonly string[]>> = {
  grades: ['1', '2', '3', '4', '5', '6'],
  points: Array.from({ length: 16 }, (_, index) => String(15 - index)),
};

export type Limits = readonly (number | null)[];

export interface Grading {
  readonly enabled: boolean;
  readonly scale: GradeScale;
  readonly limits: Readonly<Record<GradeScale, Limits>>;
}

export const MAX_LIMIT = 100;

const emptyLimits = (scale: GradeScale): Limits => GRADES[scale].slice(0, -1).map(() => null);

export function defaultGrading(): Grading {
  return {
    enabled: false,
    scale: 'grades',
    limits: { grades: emptyLimits('grades'), points: emptyLimits('points') },
  };
}

export function limitCount(scale: GradeScale): number {
  return GRADES[scale].length - 1;
}

export function isLimit(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_LIMIT &&
    Math.round(value * 10) / 10 === value
  );
}

export function parseLimit(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^\d{1,3}(?:[.,]\d)?$/u.test(trimmed)) return undefined;
  const value = Number(trimmed.replace(',', '.'));
  return isLimit(value) ? value : undefined;
}

export function formatLimit(value: number | null): string {
  return value === null
    ? ''
    : value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function misorderedLimits(limits: Limits): ReadonlySet<number> {
  const wrong = new Set<number>();
  let previous = -1;
  limits.forEach((limit, index) => {
    if (limit === null) return;
    if (limit <= previous) wrong.add(index);
    else previous = limit;
  });
  return wrong;
}

export function activeLimits(grading: Grading): Limits | null {
  if (!grading.enabled) return null;
  const limits = grading.limits[grading.scale];
  if (limits.every((limit) => limit === null)) return null;
  if (misorderedLimits(limits).size > 0) return null;
  return limits;
}

export function gradeOf(quotient: number, grading: Grading): string | null {
  const limits = activeLimits(grading);
  if (limits === null) return null;
  const shown = Number(quotient.toFixed(1));
  const grades = GRADES[grading.scale];
  const index = limits.findIndex((limit) => limit !== null && shown <= limit);
  return grades[index < 0 ? grades.length - 1 : index] ?? null;
}

export function gradeFor(statistics: WeightedStatistics | null, grading: Grading): string | null {
  if (statistics === null || statistics.words === 0) return null;
  return gradeOf(statistics.quotient, grading);
}

export function gradeColumn(scale: GradeScale): string {
  return scale === 'grades' ? 'Note' : 'Punkte';
}

export function gradeText(grade: string, scale: GradeScale): string {
  if (scale === 'grades') return `Note ${grade}`;
  return grade === '1' ? '1 Punkt' : `${grade} Punkte`;
}
