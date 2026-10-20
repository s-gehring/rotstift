import { describe, expect, it } from 'vitest';
import { CATALOG, LANGUAGE_CODES, findErrorKind, isLanguageCode } from './catalog.ts';
import { lineSchema } from './transcript.ts';

describe('catalog', () => {
  it('contains the usual German correction marks', () => {
    const codes = CATALOG.de.kinds.map((kind) => kind.code);
    expect(codes).toEqual(expect.arrayContaining(['R', 'Z', 'G', 'A', 'Sb', 'T', 'Bz', 'W']));
  });

  it('contains the usual English correction marks', () => {
    const codes = CATALOG.en.kinds.map((kind) => kind.code);
    expect(codes).toEqual(expect.arrayContaining(['sp', 'gr', 'voc', 'ww', 'wo', 'p', 't']));
  });

  it.each(['fr', 'es'] as const)('contains the usual correction marks for %s', (language) => {
    const codes = CATALOG[language].kinds.map((kind) => kind.code);
    expect(codes).toEqual(expect.arrayContaining(['R', 'Z', 'G', 'W', 'Sb', 'T', 'M']));
  });

  it.each(LANGUAGE_CODES)('has unique, case-insensitively distinct codes for %s', (language) => {
    const codes = CATALOG[language].kinds.map((kind) => kind.code.toLowerCase());
    expect(new Set(codes).size).toBe(codes.length);
  });

  it.each(LANGUAGE_CODES)('has complete entries for %s', (language) => {
    expect(CATALOG[language].name).not.toBe('');
    for (const kind of CATALOG[language].kinds) {
      expect(kind.code).toMatch(/^[A-Za-zÄÖÜäöü]+$/);
      expect(kind.name).not.toBe('');
      expect(kind.description).not.toBe('');
    }
  });

  it.each(LANGUAGE_CODES)('has valid examples for %s', (language) => {
    for (const kind of CATALOG[language].kinds) {
      const { before, original, correction, after } = kind.example;
      const result = lineSchema.safeParse({
        number: 1,
        text: before + original + after,
        marks: [
          {
            kind: original === '' ? 'omission' : 'error',
            type: kind.code,
            original,
            correction,
            offset: before.length,
          },
        ],
      });
      expect(result.success, `${language}/${kind.code}`).toBe(true);
    }
  });

  it('finds kinds by exact and case-insensitive code', () => {
    expect(findErrorKind('de', 'Sb')?.name).toBe('Satzbau');
    expect(findErrorKind('de', 'sb')?.code).toBe('Sb');
    expect(findErrorKind('de', 'r')?.code).toBe('R');
    expect(findErrorKind('en', 'SP')?.code).toBe('sp');
  });

  it('does not find codes of other languages or unknown codes', () => {
    expect(findErrorKind('de', 'voc')).toBeUndefined();
    expect(findErrorKind('en', 'Bz')).toBeUndefined();
    expect(findErrorKind('de', '')).toBeUndefined();
  });

  it('recognizes language codes', () => {
    expect(isLanguageCode('de')).toBe(true);
    expect(isLanguageCode('fr')).toBe(true);
    expect(isLanguageCode('it')).toBe(false);
  });
});
