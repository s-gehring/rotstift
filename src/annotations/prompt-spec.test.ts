// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CATALOG, LANGUAGE_CODES } from './catalog.ts';
import { parseTranscript } from './parse.ts';
import { BUILT_IN_PROFILES, DEUTSCH, ENGLISCH, profileSchema } from './profile.ts';
import { buildSpecification, renderExample } from './prompt-spec.ts';

describe('buildSpecification', () => {
  it('lists every allowed type with name, description and example', () => {
    const spec = buildSpecification(DEUTSCH);
    expect(spec).toContain('Fach: Deutsch, Sprache: Deutsch');
    expect(spec).toContain('- Sb (Satzbau): Falsche Wortstellung');
    expect(spec).toContain(
      '<rs-line n="1">Am Samstag waren wir im <rs-error type="R" fix="Schwimmbad">Schwimbad</rs-error>.</rs-line>',
    );
    for (const kind of CATALOG.de.kinds) {
      expect(spec).toContain(`- ${kind.code} (${kind.name}):`);
    }
  });

  it('describes the omission form and the closing tag', () => {
    const spec = buildSpecification(DEUTSCH);
    expect(spec).toContain('<rs-missing type="KÜRZEL" fix="FEHLENDER TEXT"></rs-missing>');
    expect(spec).toContain(
      'Ich glaube<rs-missing type="Z" fix=","></rs-missing> dass er morgen kommt.',
    );
  });

  it('contains only the types of a reduced profile', () => {
    const profile = profileSchema.parse({ ...DEUTSCH, allowedTypes: ['R', 'Z'] });
    const spec = buildSpecification(profile);
    expect(spec).toContain('- R (Rechtschreibung)');
    expect(spec).toContain('- Z (Zeichensetzung)');
    expect(spec).not.toContain('- Sb (');
    expect(spec).not.toContain('Bz');
  });

  it('uses the language of the profile', () => {
    const spec = buildSpecification(ENGLISCH);
    expect(spec).toContain('Sprache: Englisch');
    expect(spec).toContain('- voc (Wortschatz (vocabulary))');
    expect(spec).not.toContain('- Sb (');
  });

  it('throws a clear error for a profile that bypassed validation', () => {
    expect(() => buildSpecification({ ...DEUTSCH, allowedTypes: ['voc'] })).toThrow(
      'Fehlerart „voc“ fehlt im Katalog für Deutsch.',
    );
  });
});

describe('renderExample', () => {
  it.each(LANGUAGE_CODES)('renders examples for %s that the parser accepts', (language) => {
    const profile = BUILT_IN_PROFILES.find((candidate) => candidate.language === language);
    for (const kind of CATALOG[language].kinds) {
      const result = parseTranscript(renderExample(kind), { profile });
      expect(result.ok, `${language}/${kind.code}`).toBe(true);
    }
  });
});
