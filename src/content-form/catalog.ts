export type CommentKind = 'content' | 'form';

export interface FormFeature {
  readonly question: string;
  readonly comment: string;
}

export interface TextForm {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly features: readonly FormFeature[];
}

const feature = (question: string, comment: string): FormFeature => ({ question, comment });

const ORT_DATUM = feature('Stehen Ort und Datum am Anfang?', 'Ort und Datum fehlen');
const BETREFF = feature('Gibt es eine Betreffzeile?', 'Betreffzeile fehlt');
const FORMAL_ANREDE = feature(
  'Ist die Anrede förmlich, etwa „Sehr geehrte Damen und Herren“?',
  'Anrede nicht förmlich',
);
const SIEZEN = feature('Wird der Empfänger durchgehend gesiezt?', 'Sie-Form verwenden');
const FORMAL_GRUSS = feature(
  'Endet das Schreiben mit einer förmlichen Grußformel?',
  'Grußformel nicht förmlich',
);
const EINLEITUNG = feature(
  'Gibt es eine Einleitung, die zur Fragestellung hinführt?',
  'Einleitung fehlt',
);
const BELEG = feature(
  'Ist jedes Argument begründet und mit einem Beispiel belegt?',
  'Argument ohne Beleg',
);
const SACHLICH = feature(
  'Ist der Text sachlich, ohne persönliche Wertungen?',
  'Wertung, bitte sachlich',
);

export const TEXT_FORMS: readonly TextForm[] = [
  {
    name: 'Persönlicher Brief',
    aliases: ['Brief', 'Privatbrief', 'Freundschaftsbrief'],
    features: [
      ORT_DATUM,
      feature('Beginnt der Brief mit einer Anrede?', 'Anrede fehlt'),
      feature('Endet der Brief mit Grußformel und Namen?', 'Grußformel fehlt'),
    ],
  },
  {
    name: 'Formeller Brief',
    aliases: ['Sachlicher Brief', 'Geschäftsbrief', 'Offizieller Brief'],
    features: [ORT_DATUM, BETREFF, FORMAL_ANREDE, SIEZEN, FORMAL_GRUSS],
  },
  {
    name: 'Bewerbungsschreiben',
    aliases: ['Bewerbung', 'Anschreiben', 'Bewerbungsanschreiben'],
    features: [BETREFF, FORMAL_ANREDE, SIEZEN, FORMAL_GRUSS],
  },
  {
    name: 'E-Mail',
    aliases: ['Mail'],
    features: [
      BETREFF,
      feature('Beginnt die E-Mail mit einer Anrede?', 'Anrede fehlt'),
      feature('Endet die E-Mail mit Grußformel und Namen?', 'Grußformel fehlt'),
    ],
  },
  {
    name: 'Leserbrief',
    aliases: [],
    features: [
      feature('Nennt der Text den Artikel, auf den er antwortet?', 'Bezug zum Artikel fehlt'),
      feature('Beginnt der Text mit einer Anrede an die Redaktion?', 'Anrede fehlt'),
      feature('Wird die eigene Meinung begründet?', 'Meinung ohne Begründung'),
      feature('Endet der Text mit Grußformel und Namen?', 'Grußformel fehlt'),
    ],
  },
  {
    name: 'Lineare Erörterung',
    aliases: ['Erörterung', 'Steigernde Erörterung'],
    features: [
      EINLEITUNG,
      BELEG,
      feature('Werden auch Gegenargumente genannt und abgewogen?', 'Gegenargumente fehlen'),
      feature('Endet der Text mit einem Schluss und eigener Meinung?', 'Schluss mit Fazit fehlt'),
    ],
  },
  {
    name: 'Dialektische Erörterung',
    aliases: ['Pro-und-Contra-Erörterung', 'Pro-Contra-Erörterung', 'Antithetische Erörterung'],
    features: [
      EINLEITUNG,
      feature('Gibt es Argumente dafür?', 'Pro-Argumente fehlen'),
      feature('Gibt es Argumente dagegen?', 'Contra-Argumente fehlen'),
      BELEG,
      feature(
        'Wägt der Schluss beide Seiten ab und nennt eine Meinung?',
        'Abwägung im Schluss fehlt',
      ),
    ],
  },
  {
    name: 'Bericht',
    aliases: ['Zeitungsbericht', 'Unfallbericht', 'Nachricht', 'Zeitungsartikel'],
    features: [
      SACHLICH,
      feature('Steht der Text im Präteritum?', 'Präteritum verwenden'),
      feature('Beantwortet der Text wer, was, wann und wo?', 'W-Frage offen'),
    ],
  },
  {
    name: 'Inhaltsangabe',
    aliases: ['Zusammenfassung'],
    features: [
      feature('Nennt der erste Satz Titel, Autor und Textsorte?', 'Einleitungssatz fehlt'),
      feature('Steht der Text im Präsens?', 'Präsens verwenden'),
      feature('Kommt der Text ohne wörtliche Rede aus?', 'Keine wörtliche Rede'),
      feature('Kommt der Text ohne persönliche Wertung aus?', 'Keine persönliche Wertung'),
    ],
  },
  {
    name: 'Vorgangsbeschreibung',
    aliases: ['Anleitung', 'Rezept', 'Bastelanleitung', 'Spielanleitung', 'Bedienungsanleitung'],
    features: [
      feature('Werden zuerst alle Zutaten oder Materialien genannt?', 'Zutaten und Geräte fehlen'),
      feature('Sind alle Schritte vollständig und in der richtigen Reihenfolge?', 'Schritt fehlt'),
      feature(
        'Ist der Text sachlich im Präsens, ohne eigene Erlebnisse?',
        'Erlebnis statt Anleitung',
      ),
    ],
  },
  {
    name: 'Beschreibung',
    aliases: [
      'Wegbeschreibung',
      'Personenbeschreibung',
      'Bildbeschreibung',
      'Gegenstandsbeschreibung',
      'Tierbeschreibung',
    ],
    features: [
      feature('Ist der Text sachlich im Präsens geschrieben?', 'Sachlich im Präsens beschreiben'),
      feature(
        'Enthält der Text genaue Angaben, etwa zu Lage, Aussehen oder Richtung?',
        'Genaue Angaben fehlen',
      ),
    ],
  },
  {
    name: 'Erzählung',
    aliases: [
      'Erlebniserzählung',
      'Geschichte',
      'Fantasiegeschichte',
      'Bildergeschichte',
      'Nacherzählung',
    ],
    features: [
      feature(
        'Hat die Erzählung eine Einleitung, einen Höhepunkt und einen Schluss?',
        'Aufbau unvollständig',
      ),
      feature('Steht die Erzählung durchgehend in einer Zeitform?', 'Zeitform wechselt'),
    ],
  },
  {
    name: 'Chronik',
    aliases: [],
    features: [
      feature('Werden die Ereignisse in zeitlicher Reihenfolge berichtet?', 'Zeitfolge unklar'),
    ],
  },
];

export function normalizeFormName(name: string): string {
  return name
    .toLocaleLowerCase('de')
    .replaceAll('ß', 'ss')
    .replaceAll(/[^\p{L}\p{N}]+/gu, '');
}

const BY_NAME = new Map(
  TEXT_FORMS.flatMap((form) =>
    [form.name, ...form.aliases].map((name) => [normalizeFormName(name), form] as const),
  ),
);

export function findTextForm(name: string): TextForm | null {
  return BY_NAME.get(normalizeFormName(name)) ?? null;
}

export const FORM_SUGGESTIONS: readonly string[] = TEXT_FORMS.flatMap((form) => [
  form.name,
  ...form.aliases,
]);
