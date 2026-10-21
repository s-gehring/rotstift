import { z } from 'zod';
import type { CorrectionProfile } from '../annotations/profile.ts';
import { codeFor } from './kinds.ts';

export interface CorrectionScope {
  readonly spelling: boolean;
  readonly grammar: boolean;
  readonly content: boolean;
  readonly form: boolean;
  readonly formName: string;
  readonly assignment: string;
}

export type ScopeKind = 'spelling' | 'grammar' | 'content' | 'form';

export const SCOPE_KINDS: readonly ScopeKind[] = ['spelling', 'grammar', 'content', 'form'];

export const DEFAULT_SCOPE: CorrectionScope = {
  spelling: true,
  grammar: true,
  content: false,
  form: false,
  formName: '',
  assignment: '',
};

export const MAX_ASSIGNMENT_LENGTH = 2000;

export const SCOPE_STORAGE_KEY = 'rotstift.correction-scope';

export type ScopeStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function spellingCodes(profile: CorrectionProfile): readonly string[] {
  return [codeFor(profile, 'spelling'), codeFor(profile, 'punctuation')].filter(
    (code): code is string => code !== null,
  );
}

export function requestedCodes(
  profile: CorrectionProfile,
  scope: CorrectionScope,
): readonly string[] {
  const spelling = new Set(spellingCodes(profile));
  return profile.allowedTypes.filter((code) =>
    spelling.has(code) ? scope.spelling : scope.grammar,
  );
}

export function scopedProfile(
  profile: CorrectionProfile,
  scope: CorrectionScope,
): CorrectionProfile {
  const allowedTypes = requestedCodes(profile, scope);
  return allowedTypes.length === profile.allowedTypes.length
    ? profile
    : { ...profile, allowedTypes: [...allowedTypes] };
}

export function hasAnyKind(scope: CorrectionScope): boolean {
  return SCOPE_KINDS.some((kind) => scope[kind]);
}

export function toggleKind(scope: CorrectionScope, kind: ScopeKind): CorrectionScope {
  const next = { ...scope, [kind]: !scope[kind] };
  return hasAnyKind(next) ? next : scope;
}

export function cleanAssignment(text: string): string {
  const cleaned = text
    .replaceAll(/\r\n?|[\u2028\u2029]/gu, '\n')
    .replaceAll('\t', ' ')
    .replaceAll(/[<>]/gu, '')
    .replaceAll(/[^\P{Cc}\n]/gu, '')
    .replaceAll(/[ \u00a0]+\n/gu, '\n')
    .replaceAll(/\n{3,}/gu, '\n\n')
    .trim();
  return Array.from(cleaned).slice(0, MAX_ASSIGNMENT_LENGTH).join('').trimEnd();
}

const storedKindsSchema = z.object({
  spelling: z.boolean().catch(DEFAULT_SCOPE.spelling),
  grammar: z.boolean().catch(DEFAULT_SCOPE.grammar),
  content: z.boolean().catch(DEFAULT_SCOPE.content),
  form: z.boolean().catch(DEFAULT_SCOPE.form),
});

function defaultStorage(): ScopeStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadScopeKinds(
  storage: ScopeStorage | null = defaultStorage(),
): Pick<CorrectionScope, ScopeKind> {
  const fallback = storedKindsSchema.parse({});
  try {
    const raw = storage?.getItem(SCOPE_STORAGE_KEY);
    if (raw == null) return fallback;
    const stored = storedKindsSchema.safeParse(JSON.parse(raw));
    if (!stored.success || !hasAnyKind({ ...DEFAULT_SCOPE, ...stored.data })) return fallback;
    return stored.data;
  } catch {
    return fallback;
  }
}

export function saveScopeKinds(
  scope: CorrectionScope,
  storage: ScopeStorage | null = defaultStorage(),
): void {
  const kinds = Object.fromEntries(SCOPE_KINDS.map((kind) => [kind, scope[kind]]));
  try {
    storage?.setItem(SCOPE_STORAGE_KEY, JSON.stringify(kinds));
  } catch {
    return;
  }
}
