import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_PROFILES,
  DEUTSCH,
  ENGLISCH,
  FRANZOESISCH,
  getBuiltInProfile,
  SACHFACH,
  SPANISCH,
  profileSchema,
} from './profile.ts';

describe('profileSchema', () => {
  it.each(BUILT_IN_PROFILES)('accepts the built-in profile $id', (profile) => {
    expect(profileSchema.safeParse(profile).success).toBe(true);
  });

  it('accepts a reduced profile for primary school', () => {
    const profile = {
      id: 'deutsch-grundstufe',
      name: 'Deutsch Grundstufe',
      subject: 'Deutsch',
      language: 'de',
      allowedTypes: ['R', 'Z'],
    };
    expect(profileSchema.safeParse(profile).success).toBe(true);
  });

  it('rejects a type from another language', () => {
    const result = profileSchema.safeParse({ ...DEUTSCH, allowedTypes: ['R', 'voc'] });
    expect(result.error?.issues[0]?.message).toBe(
      'Die Fehlerart „voc“ gibt es im Katalog für Deutsch nicht.',
    );
  });

  it('rejects duplicate types and an empty list', () => {
    const duplicate = profileSchema.safeParse({ ...DEUTSCH, allowedTypes: ['R', 'R'] });
    expect(duplicate.error?.issues[0]?.message).toBe('Die Fehlerart „R“ steht mehrfach im Profil.');
    expect(profileSchema.safeParse({ ...DEUTSCH, allowedTypes: [] }).success).toBe(false);
  });

  it('rejects an unsupported language', () => {
    expect(profileSchema.safeParse({ ...DEUTSCH, language: 'it' }).success).toBe(false);
  });
});

describe('built-in profiles', () => {
  it('allow every catalog type of their language', () => {
    expect(DEUTSCH.allowedTypes).toContain('Bz');
    expect(ENGLISCH.allowedTypes).toContain('voc');
    expect(FRANZOESISCH.allowedTypes).toEqual(['R', 'Z', 'G', 'W', 'Sb', 'T', 'M', 'Präp']);
    expect(SPANISCH.allowedTypes).toEqual(FRANZOESISCH.allowedTypes);
  });

  it('offers the Sachfach profile in German with spelling, punctuation and grammar only', () => {
    expect(SACHFACH).toMatchObject({ language: 'de', allowedTypes: ['R', 'Z', 'G'] });
    expect(new Set(BUILT_IN_PROFILES.map((profile) => profile.id)).size).toBe(
      BUILT_IN_PROFILES.length,
    );
  });

  it('can be found by id', () => {
    expect(getBuiltInProfile('englisch')).toBe(ENGLISCH);
    expect(getBuiltInProfile('franzoesisch')).toBe(FRANZOESISCH);
    expect(getBuiltInProfile('spanisch')).toBe(SPANISCH);
    expect(getBuiltInProfile('sachfach')).toBe(SACHFACH);
    expect(getBuiltInProfile('latein')).toBeUndefined();
  });
});
