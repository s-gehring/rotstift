import type { LanguageCode } from '../annotations/catalog.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';

export type MarkRole = 'spelling' | 'punctuation' | 'grammar' | 'wording' | 'wordOrder';

const CODES: Record<LanguageCode, Record<MarkRole, string>> = {
  de: { spelling: 'R', punctuation: 'Z', grammar: 'G', wording: 'A', wordOrder: 'Sb' },
  en: { spelling: 'sp', punctuation: 'p', grammar: 'gr', wording: 'voc', wordOrder: 'wo' },
  fr: { spelling: 'R', punctuation: 'Z', grammar: 'G', wording: 'W', wordOrder: 'Sb' },
  es: { spelling: 'R', punctuation: 'Z', grammar: 'G', wording: 'W', wordOrder: 'Sb' },
};

export function codeFor(profile: CorrectionProfile, role: MarkRole): string | null {
  const code = CODES[profile.language][role];
  return profile.allowedTypes.includes(code) ? code : null;
}
