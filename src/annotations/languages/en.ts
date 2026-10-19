import type { LanguageCatalog } from '../catalog-types.ts';

export const en: LanguageCatalog = {
  name: 'Englisch',
  kinds: [
    {
      code: 'sp',
      name: 'Rechtschreibung (spelling)',
      description: 'Falsch geschriebenes Wort.',
      example: {
        before: 'I ',
        original: 'recieved',
        correction: 'received',
        after: ' your letter.',
      },
    },
    {
      code: 'gr',
      name: 'Grammatik (grammar)',
      description: 'Grammatikfehler, etwa bei Verbform, Kongruenz, Pronomen oder Plural.',
      example: { before: 'She ', original: "don't", correction: "doesn't", after: ' like apples.' },
    },
    {
      code: 't',
      name: 'Zeitform (tense)',
      description: 'Falsche Zeitform oder Zeitenfolge.',
      example: {
        before: 'Yesterday I ',
        original: 'go',
        correction: 'went',
        after: ' to the cinema.',
      },
    },
    {
      code: 'wo',
      name: 'Wortstellung (word order)',
      description: 'Wörter stehen in der falschen Reihenfolge.',
      example: {
        before: 'I like ',
        original: 'very much music',
        correction: 'music very much',
        after: '.',
      },
    },
    {
      code: 'p',
      name: 'Zeichensetzung (punctuation)',
      description:
        'Fehlendes, überflüssiges oder falsches Satzzeichen. Ein fehlendes Zeichen wird als Auslassung markiert.',
      example: { before: 'However', original: '', correction: ',', after: ' I disagree.' },
    },
    {
      code: 'voc',
      name: 'Wortschatz (vocabulary)',
      description:
        'Unidiomatische oder ungenaue Wortwahl, falsche Kollokation, unpassendes Register.',
      example: { before: 'She ', original: 'did', correction: 'made', after: ' a mistake.' },
    },
    {
      code: 'ww',
      name: 'Falsches Wort (wrong word)',
      description: 'Wort mit anderer Bedeutung als gemeint, etwa ein falscher Freund.',
      example: {
        before: 'I ',
        original: 'became',
        correction: 'got',
        after: ' a new bike for my birthday.',
      },
    },
    {
      code: 'art',
      name: 'Artikel (article)',
      description: 'Fehlender, überflüssiger oder falscher Artikel.',
      example: { before: 'I have ', original: '', correction: 'a', after: 'dog.' },
    },
  ],
};
