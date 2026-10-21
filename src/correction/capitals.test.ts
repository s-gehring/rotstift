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

  it('keeps a lowered adjective of a fixed name', () => {
    expect(
      keep('Im Sommer waren wir am Schwarzen Meer.', 'Im Sommer waren wir am schwarzen Meer.'),
    ).toBe('Im Sommer waren wir am Schwarzen Meer.');
  });

  it('keeps every lowered adjective of a fixed name with several adjectives', () => {
    expect(
      keep(
        'Viele Länder gehörten zum Heiligen Römischen Reich.',
        'Viele Länder gehörten zum heiligen römischen Reich.',
      ),
    ).toBe('Viele Länder gehörten zum Heiligen Römischen Reich.');
  });

  it('keeps fixed names in every inflection', () => {
    const text = 'Mein Opa erzählt vom Zweiten Weltkrieg und vom Kalten Krieg.';
    const corrected = 'Mein Opa erzählt vom zweiten Weltkrieg und vom kalten Krieg.';
    expect(keep(text, corrected)).toBe(text);
  });

  it('lowers capitalised adjectives before ordinary nouns', () => {
    expect(keep('Wir sahen ein Rotes Auto.', 'Wir sahen ein rotes Auto.')).toBe(
      'Wir sahen ein rotes Auto.',
    );
  });

  it('lowers a listed adjective when the noun is not capitalised', () => {
    expect(keep('Er malte ein Rotes kreuz.', 'Er malte ein rotes Kreuz.')).toBe(
      'Er malte ein rotes Kreuz.',
    );
  });

  it('keeps lowered adjectives before capitalised nouns out of the collapse share', () => {
    const corrected = 'Wir hatten einen schönen Ausflug, sahen kleine Affen und waren müde.';
    expect(
      keep('Wir hatten einen Schönen Ausflug, sahen Kleine Affen und waren Müde.', corrected),
    ).toBe(corrected);
  });

  it('capitalises a lowercase proper name after a definite article', () => {
    expect(
      keep(
        'Wir waren am schwarzen Meer und im heiligen römischen Reich.',
        'Wir waren am schwarzen Meer und im heiligen römischen Reich.',
      ),
    ).toBe('Wir waren am Schwarzen Meer und im Heiligen Römischen Reich.');
  });

  it('leaves lowercase phrases that are also ordinary German', () => {
    const text = 'Der große Wagen meines Vaters steht am runden Tisch vor dem weißen Haus.';
    expect(keep(text, text)).toBe(text);
  });

  it('capitalises proper names only after a definite article', () => {
    const text = 'Sie malte ein rotes Kreuz auf ein schwarzes Meer aus Papier.';
    expect(keep(text, text)).toBe(text);
  });

  it('protects fixed names only in German', () => {
    expect(keep('Il a vu la Mer Noire.', 'Il a vu la mer Noire.', 'fr')).toBe(
      'Il a vu la mer Noire.',
    );
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

  it('marks no lowered adjective of a fixed name', () => {
    const lines = ['Meine Mutter arbeitet beim Roten Kreuz und liebt das Rote Auto.'];
    const corrected = 'Meine Mutter arbeitet beim roten Kreuz und liebt das rote Auto.';
    const marks = deriveMarks(lines, corrected, { profile: DEUTSCH })[0]?.marks;
    expect(marks?.map((mark) => [mark.original, mark.correction])).toEqual([['Rote', 'rote']]);
  });

  it('marks a lowercase proper name', () => {
    const lines = ['Meine Tante arbeitet beim roten Kreuz.'];
    const marks = deriveMarks(lines, lines[0] ?? '', { profile: DEUTSCH })[0]?.marks;
    expect(marks?.map((mark) => [mark.original, mark.correction, mark.type])).toEqual([
      ['roten', 'Roten', 'R'],
    ]);
  });

  it('still marks lowered French nationality words', () => {
    const lines = ['Marie parle Anglais et Allemand.'];
    const corrected = 'Marie parle anglais et allemand.';
    expect(deriveMarks(lines, corrected, { profile: FRANZOESISCH })[0]?.marks).toHaveLength(2);
  });
});
