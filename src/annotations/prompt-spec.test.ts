// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog.ts';
import { parseTranscript } from './parse.ts';
import { BUILT_IN_PROFILES, DEUTSCH, ENGLISCH, profileSchema } from './profile.ts';
import { buildSpecification, renderExample } from './prompt-spec.ts';
import { DEFAULT_SCOPE } from '../correction/scope.ts';

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

  it('is unchanged with the default scope', () => {
    expect(buildSpecification(DEUTSCH, DEFAULT_SCOPE)).toBe(buildSpecification(DEUTSCH));
  });

  it('names only the requested types', () => {
    const spelling = buildSpecification(DEUTSCH, { ...DEFAULT_SCOPE, grammar: false });
    expect(spelling).toContain('- R (Rechtschreibung)');
    expect(spelling).toContain('- Z (Zeichensetzung)');
    expect(spelling).not.toContain('- G (');
    expect(spelling).not.toContain('- A (');
    const grammar = buildSpecification(ENGLISCH, { ...DEFAULT_SCOPE, spelling: false });
    expect(grammar).toContain('- gr (');
    expect(grammar).not.toContain('- sp (');
    expect(grammar).not.toContain('- p (');
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
  it.each(BUILT_IN_PROFILES)('renders examples for $id that the parser accepts', (profile) => {
    for (const kind of CATALOG[profile.language].kinds.filter((entry) =>
      profile.allowedTypes.includes(entry.code),
    )) {
      const result = parseTranscript(renderExample(kind), { profile });
      expect(result.ok, `${profile.id}/${kind.code}`).toBe(true);
    }
  });
});
