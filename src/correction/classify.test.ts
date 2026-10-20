import { describe, expect, it } from 'vitest';
import { classifyWordChange } from './classify.ts';

describe('classifyWordChange', () => {
  it.each([
    ['dank', 'Dank', 'de', 'spelling'],
    ['Schockolade', 'Schokolade', 'de', 'spelling'],
    ['das', 'dass', 'de', 'spelling'],
    ['geregent', 'geregnet', 'de', 'spelling'],
    ['dem', 'des', 'de', 'grammar'],
    ['möchte', 'möchten', 'de', 'grammar'],
    ['ist', 'sei', 'de', 'grammar'],
    ['voll', 'sehr', 'de', 'wording'],
    ['like', 'likes', 'en', 'grammar'],
    ['recieved', 'received', 'en', 'spelling'],
    ['big', 'huge', 'en', 'wording'],
    ['gateau', 'gâteau', 'fr', 'spelling'],
    ['a', 'à', 'fr', 'spelling'],
    ['content', 'contentes', 'fr', 'grammar'],
    ['devrait', 'devraient', 'fr', 'grammar'],
    ['est', 'a', 'fr', 'grammar'],
    ['fait', 'pris', 'fr', 'wording'],
    ['colejio', 'colegio', 'es', 'spelling'],
    ['Despues', 'Después', 'es', 'spelling'],
    ['bonito', 'bonitas', 'es', 'grammar'],
    ['usa', 'usan', 'es', 'grammar'],
    ['compró', 'compraron', 'es', 'grammar'],
    ['pero', 'perro', 'es', 'spelling'],
    ['miré', 'vi', 'es', 'wording'],
  ] as const)('%s to %s (%s) is %s', (original, correction, language, role) => {
    expect(classifyWordChange(original, correction, language)).toBe(role);
  });
});
