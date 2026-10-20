import { describe, expect, it } from 'vitest';
import { DEUTSCH, ENGLISCH } from '../annotations/profile.ts';
import { PROFILE_STORAGE_KEY, loadProfile, saveProfile } from './profile-choice.ts';
import type { ProfileStorage } from './profile-choice.ts';

function memoryStorage(initial: Record<string, string> = {}): ProfileStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const throwing: ProfileStorage = {
  getItem: () => {
    throw new Error('gesperrt');
  },
  setItem: () => {
    throw new Error('gesperrt');
  },
};

describe('loadProfile', () => {
  it('restores the stored profile', () => {
    const storage = memoryStorage({ [PROFILE_STORAGE_KEY]: ENGLISCH.id });
    expect(loadProfile([DEUTSCH, ENGLISCH], storage)).toBe(ENGLISCH);
  });

  it('falls back to the first profile for an unknown or missing id', () => {
    expect(loadProfile([DEUTSCH, ENGLISCH], memoryStorage())).toBe(DEUTSCH);
    expect(loadProfile([DEUTSCH, ENGLISCH], memoryStorage({ [PROFILE_STORAGE_KEY]: 'weg' }))).toBe(
      DEUTSCH,
    );
  });

  it('survives storage that throws or is missing', () => {
    expect(loadProfile([DEUTSCH, ENGLISCH], throwing)).toBe(DEUTSCH);
    expect(loadProfile([DEUTSCH, ENGLISCH], null)).toBe(DEUTSCH);
  });

  it('refuses an empty profile list', () => {
    expect(() => loadProfile([], memoryStorage())).toThrow('Korrekturprofil');
  });
});

describe('saveProfile', () => {
  it('stores the profile id', () => {
    const storage = memoryStorage();
    saveProfile(ENGLISCH, storage);
    expect(storage.data).toEqual({ [PROFILE_STORAGE_KEY]: ENGLISCH.id });
  });

  it('ignores storage that throws or is missing', () => {
    expect(() => {
      saveProfile(ENGLISCH, throwing);
      saveProfile(ENGLISCH, null);
    }).not.toThrow();
  });
});
