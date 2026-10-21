import { describe, expect, it } from 'vitest';
import { FORM_SUGGESTIONS, TEXT_FORMS, findTextForm, normalizeFormName } from './catalog.ts';
import { COMMENT_MAX_LENGTH } from './review.ts';

describe('findTextForm', () => {
  it.each(['e-mail', 'EMAIL', 'Mail', ' E Mail ', 'E-Mail'])(
    'finds the E-Mail form for %s',
    (name) => {
      expect(findTextForm(name)?.name).toBe('E-Mail');
    },
  );

  it('finds a form by an alias with hyphens', () => {
    expect(findTextForm('Pro-und-Contra-Erörterung')?.name).toBe('Dialektische Erörterung');
  });

  it('finds a form by its own name', () => {
    expect(findTextForm('Leserbrief')?.name).toBe('Leserbrief');
  });

  it('ignores case of umlauts', () => {
    expect(findTextForm('ERÖRTERUNG')?.name).toBe('Lineare Erörterung');
  });

  it('returns null for unknown names', () => {
    expect(findTextForm('Gedicht')).toBeNull();
    expect(findTextForm('')).toBeNull();
  });
});

describe('normalizeFormName', () => {
  it('drops spaces, hyphens and case and folds ß', () => {
    expect(normalizeFormName('Groß-Schreibung')).toBe('grossschreibung');
  });
});

describe('text form catalog', () => {
  it('has no duplicate suggestions after normalizing', () => {
    const normalized = FORM_SUGGESTIONS.map(normalizeFormName);
    expect(new Set(normalized).size).toBe(normalized.length);
  });

  it('lists every name and alias as a suggestion', () => {
    const expected = TEXT_FORMS.flatMap((form) => [form.name, ...form.aliases]);
    expect(FORM_SUGGESTIONS).toEqual(expected);
  });

  it('gives every form at least one feature', () => {
    for (const form of TEXT_FORMS) expect(form.features.length).toBeGreaterThan(0);
  });

  it('keeps every feature comment within the comment limit', () => {
    for (const form of TEXT_FORMS) {
      for (const entry of form.features) {
        expect(Array.from(entry.comment).length).toBeLessThanOrEqual(COMMENT_MAX_LENGTH);
        expect(entry.comment).not.toBe('');
        expect(entry.question).not.toBe('');
      }
    }
  });
});
