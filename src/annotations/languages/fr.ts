import type { LanguageCatalog } from '../catalog-types.ts';

export const fr: LanguageCatalog = {
  name: 'Französisch',
  kinds: [
    {
      code: 'R',
      name: 'Rechtschreibung (orthographe)',
      description:
        'Falsch geschriebenes Wort, auch fehlende oder falsche Akzente und Cédille sowie Groß- und Kleinschreibung.',
      example: {
        before: "J'ai mangé un ",
        original: 'gateau',
        correction: 'gâteau',
        after: ' au chocolat.',
      },
    },
    {
      code: 'Z',
      name: 'Zeichensetzung (ponctuation)',
      description:
        'Fehlendes, überflüssiges oder falsches Satzzeichen. Ein fehlendes Zeichen wird als Auslassung markiert.',
      example: {
        before: 'Quand il pleut',
        original: '',
        correction: ',',
        after: ' je reste à la maison.',
      },
    },
    {
      code: 'G',
      name: 'Grammatik (grammaire)',
      description:
        'Fehler bei Genus, Numerus, Angleichung (accord), Artikel, Pronomen oder Verbform.',
      example: {
        before: 'Les filles sont ',
        original: 'content',
        correction: 'contentes',
        after: ' de partir.',
      },
    },
    {
      code: 'W',
      name: 'Wortschatz (vocabulaire)',
      description:
        'Falsches, ungenaues oder erfundenes Wort, falscher Freund (faux ami), falsche Kollokation, unidiomatische Formulierung.',
      example: {
        before: "Hier, j'ai ",
        original: 'fait',
        correction: 'pris',
        after: ' un café avec mon amie.',
      },
    },
    {
      code: 'Sb',
      name: 'Satzbau (syntaxe)',
      description:
        'Falsche Wortstellung oder verunglückter Satz, etwa bei Pronomen und Verneinung.',
      example: {
        before: 'Je veux ',
        original: 'lui le',
        correction: 'le lui',
        after: ' donner.',
      },
    },
    {
      code: 'T',
      name: 'Zeitform (temps)',
      description: 'Falsche Zeitform oder Zeitenfolge, etwa passé composé statt imparfait.',
      example: {
        before: 'Hier, nous ',
        original: 'allons',
        correction: 'sommes allés',
        after: ' au parc.',
      },
    },
    {
      code: 'M',
      name: 'Modus (mode)',
      description: 'Falscher Modus, etwa Indikativ statt subjonctif.',
      example: {
        before: 'Il faut que tu ',
        original: 'viens',
        correction: 'viennes',
        after: ' demain.',
      },
    },
    {
      code: 'Präp',
      name: 'Präposition (préposition)',
      description: 'Falsche, fehlende oder überflüssige Präposition.',
      example: {
        before: 'Je pense ',
        original: 'de',
        correction: 'à',
        after: ' mes vacances.',
      },
    },
  ],
};
