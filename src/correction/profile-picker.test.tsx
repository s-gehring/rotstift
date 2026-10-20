// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEUTSCH, ENGLISCH } from '../annotations/profile.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';
import { PROFILE_STORAGE_KEY } from './profile-choice.ts';
import { ProfilePicker, useProfileChoice } from './ProfilePicker.tsx';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const SACHUNTERRICHT: CorrectionProfile = {
  id: 'sachunterricht',
  name: 'Sachunterricht',
  subject: 'Sachunterricht',
  language: 'de',
  allowedTypes: ['R', 'Z'],
};

const ENGLISCH_DEUTSCH: CorrectionProfile = {
  id: 'englisch-de',
  name: 'Englisch (Diktat)',
  subject: 'Englisch',
  language: 'de',
  allowedTypes: ['R'],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  localStorage.clear();
});

function render(element: React.ReactElement) {
  act(() => {
    root.render(element);
  });
}

function field(label: string): HTMLSelectElement {
  const labelElement = [...container.querySelectorAll('label')].find(
    (l) => l.textContent === label,
  );
  const control = labelElement?.htmlFor ? document.getElementById(labelElement.htmlFor) : null;
  if (!(control instanceof HTMLSelectElement)) throw new Error(`Feld ${label} fehlt`);
  return control;
}

function choose(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function Harness() {
  const { profile, select } = useProfileChoice();
  return <ProfilePicker value={profile} onChange={select} />;
}

describe('ProfilePicker', () => {
  it('offers subject and language as labelled fields with the current choice', () => {
    render(
      <ProfilePicker value={DEUTSCH} onChange={vi.fn<(profile: CorrectionProfile) => void>()} />,
    );
    expect(container.querySelector('legend')?.textContent).toBe('Korrekturprofil');
    expect(field('Fach').value).toBe('Deutsch');
    expect([...field('Fach').options].map((option) => option.text)).toEqual([
      'Deutsch',
      'Englisch',
    ]);
    expect(field('Sprache').value).toBe('de');
    expect(field('Sprache').disabled).toBe(true);
  });

  it('describes the allowed error types for assistive technology', () => {
    render(
      <ProfilePicker value={DEUTSCH} onChange={vi.fn<(profile: CorrectionProfile) => void>()} />,
    );
    const hint = container.querySelector('p');
    expect(hint?.textContent).toBe('Markiert werden: R, Z, G, A, Sb, T, Bz, W');
    expect(hint?.getAttribute('aria-live')).toBe('polite');
    expect(field('Fach').getAttribute('aria-describedby')).toBe(hint?.id);
    expect(field('Sprache').getAttribute('aria-describedby')).toBe(hint?.id);
  });

  it('reports the profile of a chosen subject', () => {
    const onChange = vi.fn<(profile: CorrectionProfile) => void>();
    render(<ProfilePicker value={DEUTSCH} onChange={onChange} />);
    choose(field('Fach'), 'Englisch');
    expect(onChange).toHaveBeenCalledWith(ENGLISCH);
  });

  it('keeps the language when the new subject offers it', () => {
    const onChange = vi.fn<(profile: CorrectionProfile) => void>();
    const profiles = [DEUTSCH, SACHUNTERRICHT, ENGLISCH, ENGLISCH_DEUTSCH];
    render(<ProfilePicker value={ENGLISCH_DEUTSCH} onChange={onChange} profiles={profiles} />);
    choose(field('Fach'), 'Sachunterricht');
    expect(onChange).toHaveBeenCalledWith(SACHUNTERRICHT);
  });

  it('lets the language be chosen when a subject has several', () => {
    const onChange = vi.fn<(profile: CorrectionProfile) => void>();
    const profiles = [DEUTSCH, ENGLISCH, ENGLISCH_DEUTSCH];
    render(<ProfilePicker value={ENGLISCH} onChange={onChange} profiles={profiles} />);
    expect(field('Sprache').disabled).toBe(false);
    expect([...field('Sprache').options].map((option) => option.text)).toEqual([
      'Englisch',
      'Deutsch',
    ]);
    choose(field('Sprache'), 'de');
    expect(onChange).toHaveBeenCalledWith(ENGLISCH_DEUTSCH);
  });

  it('disables both fields as a group', () => {
    render(
      <ProfilePicker
        value={DEUTSCH}
        onChange={vi.fn<(profile: CorrectionProfile) => void>()}
        disabled
      />,
    );
    expect(container.querySelector('fieldset')?.disabled).toBe(true);
  });
});

describe('useProfileChoice', () => {
  it('starts with the first profile and persists the choice', () => {
    render(<Harness />);
    expect(field('Fach').value).toBe('Deutsch');
    choose(field('Fach'), 'Englisch');
    expect(field('Fach').value).toBe('Englisch');
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBe('englisch');
  });

  it('restores the last choice', () => {
    localStorage.setItem(PROFILE_STORAGE_KEY, 'englisch');
    render(<Harness />);
    expect(field('Fach').value).toBe('Englisch');
  });

  it('keeps working when the storage refuses access', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('gesperrt');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('gesperrt');
    });
    render(<Harness />);
    choose(field('Fach'), 'Englisch');
    expect(field('Fach').value).toBe('Englisch');
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
