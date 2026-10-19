import type { ErrorKind, LanguageCatalog } from './catalog-types.ts';
import { de } from './languages/de.ts';
import { en } from './languages/en.ts';

export type { ErrorExample, ErrorKind, LanguageCatalog } from './catalog-types.ts';

export const LANGUAGE_CODES = ['de', 'en'] as const;

export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export const CATALOG: Record<LanguageCode, LanguageCatalog> = { de, en };

export function isLanguageCode(value: string): value is LanguageCode {
  return (LANGUAGE_CODES as readonly string[]).includes(value);
}

export function findErrorKind(language: LanguageCode, code: string): ErrorKind | undefined {
  const exact = CATALOG[language].kinds.find((kind) => kind.code === code);
  if (exact) {
    return exact;
  }
  const lower = code.toLowerCase();
  return CATALOG[language].kinds.find((kind) => kind.code.toLowerCase() === lower);
}
