import type { LanguageCatalog } from '../catalog-types.ts';

export const de: LanguageCatalog = {
  name: 'Deutsch',
  kinds: [
    {
      code: 'R',
      name: 'Rechtschreibung',
      description:
        'Falsch geschriebenes Wort, auch Groß- und Kleinschreibung sowie Getrennt- und Zusammenschreibung.',
      example: {
        before: 'Am Samstag waren wir im ',
        original: 'Schwimbad',
        correction: 'Schwimmbad',
        after: '.',
      },
    },
    {
      code: 'Z',
      name: 'Zeichensetzung',
      description:
        'Fehlendes, überflüssiges oder falsches Satzzeichen (Komma, Punkt, Anführungszeichen). Ein fehlendes Zeichen wird als Auslassung markiert.',
      example: {
        before: 'Ich glaube',
        original: '',
        correction: ',',
        after: ' dass er morgen kommt.',
      },
    },
    {
      code: 'G',
      name: 'Grammatik',
      description: 'Falscher Fall, Numerus, Genus, Artikel oder falsche Verbform.',
      example: {
        before: 'Sie gibt dem Hund ',
        original: 'ein',
        correction: 'einen',
        after: ' Knochen.',
      },
    },
    {
      code: 'A',
      name: 'Ausdruck',
      description:
        'Unpassendes, umgangssprachliches oder unbeholfenes Wort bzw. unbeholfene Formulierung.',
      example: {
        before: 'Dann ist der Mann ',
        original: 'voll schnell',
        correction: 'sehr schnell',
        after: ' weggerannt.',
      },
    },
    {
      code: 'Sb',
      name: 'Satzbau',
      description:
        'Falsche Wortstellung, unvollständiger oder verunglückter Satz, falsche Satzverknüpfung.',
      example: {
        before: 'Weil ',
        original: 'ich war krank',
        correction: 'ich krank war',
        after: ', blieb ich zu Hause.',
      },
    },
    {
      code: 'T',
      name: 'Tempus',
      description: 'Falsche Zeitform oder Zeitenfolge.',
      example: {
        before: 'Gestern ',
        original: 'gehe',
        correction: 'ging',
        after: ' ich ins Kino.',
      },
    },
    {
      code: 'Bz',
      name: 'Bezug',
      description: 'Unklarer oder falscher Bezug eines Pronomens oder Satzteils.',
      example: {
        before: 'Der Hund biss den Jungen, weil ',
        original: 'er',
        correction: 'der Hund',
        after: ' Angst hatte.',
      },
    },
    {
      code: 'W',
      name: 'Wiederholung',
      description: 'Dasselbe Wort oder dieselbe Wendung kurz hintereinander.',
      example: {
        before: 'Dann ging ich heim und ',
        original: 'dann',
        correction: 'anschließend',
        after: ' aß ich.',
      },
    },
  ],
};
