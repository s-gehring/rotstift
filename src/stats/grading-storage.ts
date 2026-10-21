import {
  GRADE_SCALES,
  isLimit,
  limitCount,
  type GradeScale,
  type Grading,
  type Limits,
} from './grading.ts';

export const GRADING_STORAGE_KEY = 'rotstift.grading';

export type GradingStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type GradingOverrides = Readonly<Record<string, Grading>>;

function defaultStorage(): GradingStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScale(value: unknown): value is GradeScale {
  return GRADE_SCALES.some((scale) => scale === value);
}

function readLimits(value: unknown, scale: GradeScale): Limits | null {
  if (!Array.isArray(value) || value.length !== limitCount(scale)) return null;
  const limits = value.map((limit: unknown) => (isLimit(limit) ? limit : null));
  return limits;
}

function readGrading(value: unknown): Grading | null {
  if (!isRecord(value) || typeof value['enabled'] !== 'boolean') return null;
  const scale = value['scale'];
  const raw = value['limits'];
  if (!isScale(scale) || !isRecord(raw)) return null;
  const grades = readLimits(raw['grades'], 'grades');
  const points = readLimits(raw['points'], 'points');
  if (grades === null || points === null) return null;
  return { enabled: value['enabled'], scale, limits: { grades, points } };
}

export function loadGradings(storage: GradingStorage | null = defaultStorage()): GradingOverrides {
  try {
    const text = storage?.getItem(GRADING_STORAGE_KEY);
    if (text === null || text === undefined) return {};
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return {};
    const result: Record<string, Grading> = {};
    for (const [id, value] of Object.entries(parsed)) {
      const grading = readGrading(value);
      if (grading !== null) result[id] = grading;
    }
    return result;
  } catch {
    return {};
  }
}

export function saveGradings(
  gradings: GradingOverrides,
  storage: GradingStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(GRADING_STORAGE_KEY, JSON.stringify(gradings));
  } catch {
    return;
  }
}
