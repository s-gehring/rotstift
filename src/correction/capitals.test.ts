import { describe, expect, it } from 'vitest';
import { DEUTSCH, FRANZOESISCH } from '../annotations/profile.ts';
import { keepCapitals } from './capitals.ts';
import { deriveMarks } from './derive.ts';

function keep(text: string, corrected: string, language: 'de' | 'fr' = 'de') {
  return keepCapitals([text], corrected, language);
}

describe('keepCapitals', () => {
  it('keeps a single lowered adjective in the middle of a sentence', () => {
    expect(keep('Er ist Schnell gelaufen.', 'Er ist schnell gelaufen.')).toBe(
      'Er ist schnell gelaufen.',
    );
  });

  it('keeps raised nouns and nominalised verbs', () => {
    expect(keep('Beim laufen ist mir kalt.', 'Beim Laufen ist mir kalt.')).toBe(
      'Beim Laufen ist mir kalt.',
    );
  });

  it('restores every lowered word once a sentence start is lowered', () => {
    expect(
      keep(
        'Wir waren an der Nordsee. Die Insel Juist liegt in der Bucht.',
        'Wir waren an der nordsee. die insel juist liegt in der bucht.',
      ),
    ).toBe('Wir waren an der Nordsee. Die Insel Juist liegt in der Bucht.');
  });

  it('restores lowered words when most nouns of a German page are lowered', () => {
    expect(
      keep(
        'Im Hafen von Emden liegen Schiffe aus Norwegen und Fähren nach Borkum.',
        'Im hafen von emden liegen schiffe aus norwegen und Fähren nach Borkum.',
      ),
    ).toBe('Im Hafen von Emden liegen Schiffe aus Norwegen und Fähren nach Borkum.');
  });

  it('keeps other corrections inside a restored word', () => {
    expect(
      keep(
        'Im Hafen liegen Schifen. Sie fahren zur Insel.',
        'im hafen liegen schiffen. sie fahren zur insel.',
      ),
    ).toBe('Im Hafen liegen Schiffen. Sie fahren zur Insel.');
  });

  it('keeps several lowered words among many correct nouns', () => {
    const text =
      'Unser Trainer Herr Brandt ist Streng, im Winter ist das Training Kalt und im Sommer das Spielfeld nass.';
    const corrected =
      'Unser Trainer Herr Brandt ist streng, im Winter ist das Training kalt und im Sommer das Spielfeld nass.';
    expect(keep(text, corrected)).toBe(corrected);
  });

  it('applies the share rule only to German', () => {
    const text = 'Le Lundi et le Mardi, Marie parle Anglais.';
    const corrected = 'Le lundi et le mardi, Marie parle anglais.';
    expect(keep(text, corrected, 'fr')).toBe(corrected);
  });
});

describe('deriveMarks with lowered capitals', () => {
  it('marks no lowered noun after a lowered sentence start', () => {
    const lines = ['Die Fähre fährt zur Insel. Die Überfahrt dauert eine Stunde.'];
    const corrected = 'die fähre fährt zur insel. die überfahrt dauert eine stunde.';
    expect(deriveMarks(lines, corrected, { profile: DEUTSCH })[0]?.marks).toEqual([]);
  });

  it('still marks lowered French nationality words', () => {
    const lines = ['Marie parle Anglais et Allemand.'];
    const corrected = 'Marie parle anglais et allemand.';
    expect(deriveMarks(lines, corrected, { profile: FRANZOESISCH })[0]?.marks).toHaveLength(2);
  });
});
