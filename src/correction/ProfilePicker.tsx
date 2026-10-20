import { useCallback, useId, useState } from 'react';
import { CATALOG } from '../annotations/catalog.ts';
import { BUILT_IN_PROFILES } from '../annotations/profile.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';
import { loadProfile, saveProfile } from './profile-choice.ts';
import type { ProfileStorage } from './profile-choice.ts';
import './profile-picker.css';

export interface ProfilePickerProps {
  readonly value: CorrectionProfile;
  readonly onChange: (profile: CorrectionProfile) => void;
  readonly profiles?: readonly CorrectionProfile[];
  readonly disabled?: boolean;
}

export function useProfileChoice(
  profiles: readonly CorrectionProfile[] = BUILT_IN_PROFILES,
  storage?: ProfileStorage | null,
) {
  const [profile, setProfile] = useState(() => loadProfile(profiles, storage));
  const select = useCallback(
    (next: CorrectionProfile) => {
      setProfile(next);
      saveProfile(next, storage);
    },
    [storage],
  );
  return { profile, select };
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function ProfilePicker({
  value,
  onChange,
  profiles = BUILT_IN_PROFILES,
  disabled = false,
}: ProfilePickerProps) {
  const id = useId();
  const subjects = unique(profiles.map((profile) => profile.subject));
  const languages = unique(
    profiles.filter((profile) => profile.subject === value.subject).map((p) => p.language),
  );

  const chooseSubject = (subject: string) => {
    const candidates = profiles.filter((profile) => profile.subject === subject);
    const next = candidates.find((p) => p.language === value.language) ?? candidates[0];
    if (next) onChange(next);
  };

  const chooseLanguage = (language: string) => {
    const next = profiles.find((p) => p.subject === value.subject && p.language === language);
    if (next) onChange(next);
  };

  return (
    <fieldset className="profile-picker" disabled={disabled}>
      <legend>Korrekturprofil</legend>
      <div className="profile-picker-field">
        <label htmlFor={`${id}-subject`}>Fach</label>
        <select
          id={`${id}-subject`}
          value={value.subject}
          aria-describedby={`${id}-types`}
          onChange={(event) => {
            chooseSubject(event.target.value);
          }}
        >
          {subjects.map((subject) => (
            <option key={subject} value={subject}>
              {subject}
            </option>
          ))}
        </select>
      </div>
      <div className="profile-picker-field">
        <label htmlFor={`${id}-language`}>Sprache</label>
        <select
          id={`${id}-language`}
          value={value.language}
          disabled={languages.length < 2}
          aria-describedby={`${id}-types`}
          onChange={(event) => {
            chooseLanguage(event.target.value);
          }}
        >
          {languages.map((language) => (
            <option key={language} value={language}>
              {CATALOG[language].name}
            </option>
          ))}
        </select>
      </div>
      <p id={`${id}-types`} className="hint" aria-live="polite">
        Markiert werden: {value.allowedTypes.join(', ')}
      </p>
    </fieldset>
  );
}
