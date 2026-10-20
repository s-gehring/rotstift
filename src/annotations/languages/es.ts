import type { LanguageCatalog } from '../catalog-types.ts';

export const es: LanguageCatalog = {
  name: 'Spanisch',
  kinds: [
    {
      code: 'R',
      name: 'Rechtschreibung (ortografía)',
      description:
        'Falsch geschriebenes Wort, auch fehlende oder falsche Akzente und Tilde sowie Groß- und Kleinschreibung.',
      example: {
        before: 'Mañana voy al ',
        original: 'colejio',
        correction: 'colegio',
        after: '.',
      },
    },
    {
      code: 'Z',
      name: 'Zeichensetzung (puntuación)',
      description:
        'Fehlendes, überflüssiges oder falsches Satzzeichen, auch fehlendes ¿ oder ¡ am Satzanfang. Ein fehlendes Zeichen wird als Auslassung markiert.',
      example: {
        before: 'Hola. ',
        original: '',
        correction: '¿',
        after: 'Cómo te llamas?',
      },
    },
    {
      code: 'G',
      name: 'Grammatik (gramática)',
      description:
        'Fehler bei Genus, Numerus, Angleichung (concordancia), Artikel, Pronomen, ser/estar oder Verbform.',
      example: {
        before: 'Las casas son ',
        original: 'bonito',
        correction: 'bonitas',
        after: '.',
      },
    },
    {
      code: 'W',
      name: 'Wortschatz (vocabulario)',
      description:
        'Falsches, ungenaues oder erfundenes Wort, falscher Freund (falso amigo), falsche Kollokation, unidiomatische Formulierung.',
      example: {
        before: 'Ayer ',
        original: 'miré',
        correction: 'vi',
        after: ' a mi amiga en el parque.',
      },
    },
    {
      code: 'Sb',
      name: 'Satzbau (sintaxis)',
      description: 'Falsche Wortstellung oder verunglückter Satz, etwa bei Objektpronomen.',
      example: {
        before: '',
        original: 'Lo me',
        correction: 'Me lo',
        after: ' dijo ayer.',
      },
    },
    {
      code: 'T',
      name: 'Zeitform (tiempo)',
      description: 'Falsche Zeitform oder Zeitenfolge, etwa pretérito indefinido statt imperfecto.',
      example: {
        before: 'Ayer yo ',
        original: 'voy',
        correction: 'fui',
        after: ' al cine.',
      },
    },
    {
      code: 'M',
      name: 'Modus (modo)',
      description: 'Falscher Modus, etwa Indikativ statt subjuntivo.',
      example: {
        before: 'Espero que ',
        original: 'vienes',
        correction: 'vengas',
        after: ' mañana.',
      },
    },
    {
      code: 'Präp',
      name: 'Präposition (preposición)',
      description: 'Falsche, fehlende oder überflüssige Präposition, etwa por/para oder a/en.',
      example: {
        before: 'Voy ',
        original: 'en',
        correction: 'a',
        after: ' Madrid mañana.',
      },
    },
  ],
};
