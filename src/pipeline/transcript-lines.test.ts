import { describe, expect, it } from 'vitest';
import { countWords } from '../stats/count-words.ts';
import { splitTranscript } from './transcript-lines.ts';

describe('splitTranscript', () => {
  it('splits plain answers into lines and trims the edges', () => {
    expect(splitTranscript('\n\nErste Zeile  \nZweite Zeile\n\n')).toEqual([
      'Erste Zeile',
      'Zweite Zeile',
    ]);
    expect(splitTranscript('a\r\nb\rc')).toEqual(['a', 'b', 'c']);
  });

  it('keeps empty lines between paragraphs', () => {
    expect(splitTranscript('Absatz eins\n\nAbsatz zwei')).toEqual([
      'Absatz eins',
      '',
      'Absatz zwei',
    ]);
  });

  it('unwraps code fences and drops text around them', () => {
    expect(splitTranscript('```\nEine Zeile\nNoch eine\n```')).toEqual(['Eine Zeile', 'Noch eine']);
    expect(splitTranscript('```text\nZeile\n```\n')).toEqual(['Zeile']);
    expect(
      splitTranscript(
        'Hier ist die Transkription:\n```markdown\nText hier\n```\nHinweis: unsicher',
      ),
    ).toEqual(['Text hier']);
  });

  it('handles an unterminated fence', () => {
    expect(splitTranscript('```\nZeile eins\nZeile zwei')).toEqual(['Zeile eins', 'Zeile zwei']);
  });

  it('drops a chatty preamble and a trailing note', () => {
    expect(
      splitTranscript('Hier ist die Transkription des Textes:\n\nIch bin müde.\nDas war schön.'),
    ).toEqual(['Ich bin müde.', 'Das war schön.']);
    expect(splitTranscript('Natürlich! Hier ist der Text:\nHallo Welt')).toEqual(['Hallo Welt']);
    expect(
      splitTranscript('Ich bin müde.\n\n(Hinweis: Einige Wörter waren schwer lesbar.)'),
    ).toEqual(['Ich bin müde.']);
  });

  it('keeps student text that merely looks similar', () => {
    const text = 'Hier ist mein Hund Max.\nEr ist drei Jahre alt.';
    expect(splitTranscript(text)).toEqual(text.split('\n'));
    expect(splitTranscript('Meine Anmerkung zum Wetter ist gut.')).toHaveLength(1);
  });

  it('removes thinking blocks', () => {
    expect(splitTranscript('<think>\nhm\n</think>\nEcht')).toEqual(['Echt']);
  });

  it('returns no lines for an empty answer and never changes the word count of clean text', () => {
    expect(splitTranscript('  \n\n')).toEqual([]);
    expect(splitTranscript('')).toEqual([]);
    const text = 'Am Montag sind wir in den Wald ge-\ngangen und haben Blätter gesammelt.';
    expect(countWords(splitTranscript(text).join('\n'))).toBe(countWords(text));
  });
});
