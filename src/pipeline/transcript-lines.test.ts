import { describe, expect, it } from 'vitest';
import { countWords } from '../stats/count-words.ts';
import {
  hasRepetitionLoop,
  isDegenerateAnswer,
  parseTranscript,
  splitTranscript,
} from './transcript-lines.ts';

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

  it('keeps real student sentences that start like a preamble or end like a note', () => {
    const sentences = [
      'Dies ist ein Text über meinen Hund.',
      'Das ist der Text, den ich schreibe.',
      'Hier ist der Text',
      'Das ist die Abschrift meines Heftes',
      'Natürlich habe ich Hunger, aber ich warte',
    ];
    for (const sentence of sentences) {
      expect(splitTranscript(`${sentence}\nWir gehen heim.`)).toEqual([
        sentence,
        'Wir gehen heim.',
      ]);
    }
    expect(splitTranscript('Heute ist es kalt.\nHinweis: Vorsicht, die Pfanne ist heiß!')).toEqual([
      'Heute ist es kalt.',
      'Hinweis: Vorsicht, die Pfanne ist heiß!',
    ]);
    expect(splitTranscript('Es war einmal.\nNote: Die Geschichte ist erfunden.')).toEqual([
      'Es war einmal.',
      'Note: Die Geschichte ist erfunden.',
    ]);
    expect(splitTranscript('Ich bin müde.\n[unleserlich]')).toEqual([
      'Ich bin müde.',
      '[unleserlich]',
    ]);
  });

  it('drops a preamble only when it ends with a colon and uses model vocabulary', () => {
    expect(splitTranscript('Hier ist die Transkription:\nIch bin müde.')).toEqual([
      'Ich bin müde.',
    ]);
    expect(splitTranscript('**Transkription:**\nIch bin müde.')).toEqual(['Ich bin müde.']);
    expect(splitTranscript('Here is the transcription of the text:\nHallo')).toEqual(['Hallo']);
    expect(splitTranscript('Transkription\nIch bin müde.')).toEqual([
      'Transkription',
      'Ich bin müde.',
    ]);
  });

  it('drops a trailing model note only with model vocabulary in brackets or after a label', () => {
    expect(
      splitTranscript('Ich bin müde.\nHinweis: Einige Wörter sind unleserlich und wurden geraten.'),
    ).toEqual(['Ich bin müde.']);
    expect(
      splitTranscript('Ich bin müde.\n[Transkription ohne Gewähr, Handschrift unsicher]'),
    ).toEqual(['Ich bin müde.']);
    expect(splitTranscript('Ich bin müde.\n(Ich bin mir unsicher, ob das stimmt.)')).toEqual([
      'Ich bin müde.',
      '(Ich bin mir unsicher, ob das stimmt.)',
    ]);
    expect(splitTranscript('Ich bin müde.\n(Meine Handschrift ist heute krakelig.)')).toEqual([
      'Ich bin müde.',
      '(Meine Handschrift ist heute krakelig.)',
    ]);
  });

  it('removes thinking blocks, including unclosed and stray ones', () => {
    expect(splitTranscript('<think>\nhm\n</think>\nEcht')).toEqual(['Echt']);
    expect(splitTranscript('Echt\n<think>\nich überlege noch und')).toEqual(['Echt']);
    expect(splitTranscript('<think>\nendlos grübeln')).toEqual([]);
    expect(splitTranscript('hm ich überlege\n</think>\nEcht')).toEqual(['Echt']);
  });

  it('returns no lines for an empty answer and never changes the word count of clean text', () => {
    expect(splitTranscript('  \n\n')).toEqual([]);
    expect(splitTranscript('')).toEqual([]);
    const text = 'Am Montag sind wir in den Wald ge-\ngangen und haben Blätter gesammelt.';
    expect(countWords(splitTranscript(text).join('\n'))).toBe(countWords(text));
  });
});

describe('hasRepetitionLoop', () => {
  it('detects a repeated line, a repeated phrase and a stuck word', () => {
    const line = 'und dann sind wir nach Hause gegangen';
    expect(hasRepetitionLoop(Array.from({ length: 40 }, () => line))).toBe(true);
    expect(hasRepetitionLoop([Array.from({ length: 60 }, () => 'dann ist er').join(' ')])).toBe(
      true,
    );
    expect(hasRepetitionLoop([Array.from({ length: 100 }, () => 'das').join(' ')])).toBe(true);
  });

  it('ignores punctuation and case when comparing', () => {
    const lines = Array.from({ length: 30 }, (_, index) =>
      index % 2 === 0 ? 'Wir gehen heim, ja.' : 'wir gehen HEIM ja',
    );
    expect(hasRepetitionLoop(lines)).toBe(true);
  });

  it('keeps normal pages and short refrains', () => {
    const page = [
      'Am Montag sind wir in den Wald gegangen.',
      'Wir haben Blätter gesammelt und Pilze gesucht.',
      'Danach haben wir ein Lied gesungen.',
    ];
    expect(hasRepetitionLoop(page)).toBe(false);
    expect(hasRepetitionLoop([])).toBe(false);
    expect(hasRepetitionLoop(Array.from({ length: 6 }, () => 'Ha ha ha'))).toBe(false);
    expect(hasRepetitionLoop(Array.from({ length: 10 }, () => 'Ich darf nicht schwatzen.'))).toBe(
      false,
    );
  });

  it('keeps enumerations, shared sentence openings and repeated words in real texts', () => {
    const enumeration = [
      'Ich habe Äpfel, Birnen, Bananen, Kirschen, Pflaumen, Trauben, Orangen,',
      'Zitronen, Mandarinen, Erdbeeren, Himbeeren, Brombeeren und Heidelbeeren gekauft.',
    ];
    const openings = Array.from(
      { length: 12 },
      (_, index) => `Am Tag ${index + 1} sind wir früh aufgestanden und haben gefrühstückt.`,
    );
    const stutter = ['Es war sehr, sehr, sehr, sehr, sehr, sehr kalt und nass.'];
    const ladder = Array.from({ length: 15 }, (_, index) => `Wir gehen ${index + 1} Schritte.`);
    for (const lines of [enumeration, openings, stutter, ladder]) {
      expect(hasRepetitionLoop(lines)).toBe(false);
    }
  });
});

describe('isDegenerateAnswer', () => {
  it('flags answers that ran into the token limit, whatever they say', () => {
    expect(isDegenerateAnswer('length', ['Ein ganz normaler Satz.'])).toBe(true);
    expect(isDegenerateAnswer('stop', ['Ein ganz normaler Satz.'])).toBe(false);
    expect(isDegenerateAnswer(null, ['Ein ganz normaler Satz.'])).toBe(false);
  });

  it('flags a finished answer that is one long loop', () => {
    expect(
      isDegenerateAnswer(
        'stop',
        Array.from({ length: 40 }, () => 'und so weiter ging es'),
      ),
    ).toBe(true);
  });
});

describe('parseTranscript', () => {
  it('reports whether reasoning text was removed', () => {
    expect(parseTranscript('Hallo')).toEqual({ lines: ['Hallo'], removedThinking: false });
    expect(parseTranscript('')).toEqual({ lines: [], removedThinking: false });
    expect(parseTranscript('<think>hm</think>\nHallo')).toEqual({
      lines: ['Hallo'],
      removedThinking: true,
    });
    expect(parseTranscript('<think>endlos')).toEqual({ lines: [], removedThinking: true });
    expect(parseTranscript('hm\n</think>\nHallo').removedThinking).toBe(true);
  });
});
