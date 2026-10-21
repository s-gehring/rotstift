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
const SACHLICH = feature(
  'Ist der Text sachlich, ohne persönliche Wertungen?',
  'Wertung, bitte sachlich',
);
const PRAESENS = feature('Steht der Text im Präsens?', 'Präsens verwenden');
const SACHLICH_PRAESENS = feature(
  'Ist der Text sachlich im Präsens geschrieben?',
  'Sachlich im Präsens beschreiben',
);
const TEXTBELEG = feature(
  'Werden Aussagen mit Textstellen, Zitaten oder Zeilenangaben belegt?',
  'Textbeleg fehlt',
);
const SCHLUSS = feature(
  'Endet der Text mit einem Schluss, der die Ergebnisse zusammenfasst?',
  'Schluss fehlt',
);
const FAZIT = feature(
  'Endet der Text mit einem Schluss und eigener Meinung?',
  'Schluss mit Fazit fehlt',
);

export const TEXT_FORMS: readonly TextForm[] = [
  {
    name: 'Persönlicher Brief',
    aliases: ['Brief', 'Privatbrief', 'Freundschaftsbrief', 'Personal letter', 'Informal letter'],
    features: [
      ORT_DATUM,
      feature('Beginnt der Brief mit einer Anrede?', 'Anrede fehlt'),
      feature('Endet der Brief mit Grußformel und Namen?', 'Grußformel fehlt'),
    ],
  },
  {
    name: 'Formeller Brief',
    aliases: ['Sachlicher Brief', 'Geschäftsbrief', 'Offizieller Brief', 'Beschwerdebrief'],
    features: [ORT_DATUM, BETREFF, FORMAL_ANREDE, SIEZEN, FORMAL_GRUSS],
  },
  {
    name: 'Formal letter',
    aliases: [
      'Letter of complaint',
      'Letter of application',
      'Lettre formelle',
      'Lettre de motivation',
      'Carta formal',
      'Carta de presentación',
    ],
    features: [
      feature('Steht ein Datum am Anfang?', 'Datum fehlt'),
      feature(
        'Ist die Anrede förmlich, etwa „Dear Sir or Madam“, „Madame, Monsieur“ oder „Estimados señores“?',
        'Anrede nicht förmlich',
      ),
      feature('Nennt der erste Absatz den Anlass des Schreibens?', 'Anlass fehlt am Anfang'),
      feature(
        'Endet das Schreiben mit einer förmlichen Grußformel, etwa „Yours faithfully“, „Veuillez agréer …“ oder „Atentamente“?',
        'Grußformel nicht förmlich',
      ),
    ],
  },
  {
    name: 'Bewerbungsschreiben',
    aliases: ['Bewerbung', 'Anschreiben', 'Bewerbungsanschreiben'],
    features: [BETREFF, FORMAL_ANREDE, SIEZEN, FORMAL_GRUSS],
  },
  {
    name: 'E-Mail',
    aliases: ['Mail', 'Courriel', 'Correo electrónico'],
    features: [
      BETREFF,
      feature('Beginnt die E-Mail mit einer Anrede?', 'Anrede fehlt'),
      feature('Endet die E-Mail mit Grußformel und Namen?', 'Grußformel fehlt'),
    ],
  },
  {
    name: 'Leserbrief',
    aliases: ['Leserinnenbrief', 'Letter to the editor', 'Courrier des lecteurs'],
    features: [
      feature('Nennt der Text den Artikel, auf den er antwortet?', 'Bezug zum Artikel fehlt'),
      feature('Beginnt der Text mit einer Anrede an die Redaktion?', 'Anrede fehlt'),
      feature('Wird die eigene Meinung begründet?', 'Meinung ohne Begründung'),
      feature('Endet der Text mit Grußformel und Namen?', 'Grußformel fehlt'),
    ],
  },
  {
    name: 'Kommentar',
    aliases: ['Zeitungskommentar', 'Stellungnahme', 'Meinungsbeitrag'],
    features: [
      feature(
        'Nennt der Anfang das Thema oder Ereignis, um das es geht?',
        'Anlass fehlt am Anfang',
      ),
      feature('Wird eine eigene Meinung deutlich?', 'Eigene Meinung fehlt'),
      feature('Wird die Meinung mit Argumenten begründet?', 'Meinung ohne Begründung'),
      feature('Endet der Text mit einem Fazit oder einer Forderung?', 'Fazit fehlt'),
    ],
  },
  {
    name: 'Rezension',
    aliases: [
      'Buchrezension',
      'Filmrezension',
      'Kritik',
      'Buchkritik',
      'Filmkritik',
      'Buchbesprechung',
      'Review',
      'Book review',
      'Film review',
      'Critique',
      'Reseña',
    ],
    features: [
      feature('Nennt der Text Titel und Autor oder Regie des Werks?', 'Titel und Autor fehlen'),
      feature('Gibt der Text kurz den Inhalt des Werks wieder?', 'Kurzer Inhalt fehlt'),
      feature('Enthält der Text ein begründetes Urteil?', 'Urteil ohne Begründung'),
      PRAESENS,
    ],
  },
  {
    name: 'Lineare Erörterung',
    aliases: ['Erörterung', 'Steigernde Erörterung'],
    features: [
      EINLEITUNG,
      feature('Werden auch Gegenargumente genannt und abgewogen?', 'Gegenargumente fehlen'),
      FAZIT,
    ],
  },
  {
    name: 'Dialektische Erörterung',
    aliases: ['Pro-und-Contra-Erörterung', 'Pro-Contra-Erörterung', 'Antithetische Erörterung'],
    features: [
      EINLEITUNG,
      feature('Gibt es Argumente dafür?', 'Pro-Argumente fehlen'),
      feature('Gibt es Argumente dagegen?', 'Contra-Argumente fehlen'),
      feature(
        'Wägt der Schluss beide Seiten ab und nennt eine Meinung?',
        'Abwägung im Schluss fehlt',
      ),
    ],
  },
  {
    name: 'Essay',
    aliases: [
      'Opinion essay',
      'Argumentative essay',
      'For and against essay',
      'Essai',
      'Essai argumentatif',
      'Ensayo',
      'Ensayo argumentativo',
    ],
    features: [EINLEITUNG, FAZIT],
  },
  {
    name: 'Bericht',
    aliases: [
      'Zeitungsbericht',
      'Unfallbericht',
      'Nachricht',
      'Meldung',
      'Zeitungsartikel',
      'News report',
    ],
    features: [
      SACHLICH,
      feature('Steht der Text im Präteritum?', 'Präteritum verwenden'),
      feature('Beantwortet der Text wer, was, wann und wo?', 'W-Frage offen'),
    ],
  },
  {
    name: 'Report',
    aliases: ['Rapport', 'Informe'],
    features: [
      feature('Nennt der Anfang Zweck oder Anlass des Berichts?', 'Zweck fehlt am Anfang'),
      feature(
        'Ist der Text in Abschnitte mit Zwischenüberschriften gegliedert?',
        'Zwischenüberschriften fehlen',
      ),
      SACHLICH,
      feature('Endet der Text mit einem Fazit oder einer Empfehlung?', 'Fazit fehlt'),
    ],
  },
  {
    name: 'Protokoll',
    aliases: [
      'Verlaufsprotokoll',
      'Ergebnisprotokoll',
      'Stundenprotokoll',
      'Sitzungsprotokoll',
      'Minutes',
      'Compte rendu',
      'Acta',
    ],
    features: [
      feature('Nennt der Kopf Anlass, Datum und Teilnehmende?', 'Protokollkopf unvollständig'),
      SACHLICH,
      PRAESENS,
    ],
  },
  {
    name: 'Versuchsprotokoll',
    aliases: ['Laborprotokoll'],
    features: [
      feature('Werden Fragestellung und Material genannt?', 'Material fehlt'),
      feature('Wird die Durchführung Schritt für Schritt beschrieben?', 'Durchführung fehlt'),
      feature('Gibt es einen eigenen Teil mit der Beobachtung?', 'Beobachtung fehlt'),
      feature('Gibt es eine Auswertung der Beobachtung?', 'Auswertung fehlt'),
    ],
  },
  {
    name: 'Inhaltsangabe',
    aliases: ['Inhaltswiedergabe'],
    features: [
      feature('Nennt der erste Satz Titel, Autor und Textsorte?', 'Einleitungssatz fehlt'),
      PRAESENS,
      feature('Kommt der Text ohne wörtliche Rede aus?', 'Keine wörtliche Rede'),
      feature('Kommt der Text ohne persönliche Wertung aus?', 'Keine persönliche Wertung'),
    ],
  },
  {
    name: 'Zusammenfassung',
    aliases: ['Summary', 'Résumé', 'Resumen'],
    features: [
      feature('Nennt der erste Satz Titel und Thema des Textes?', 'Einleitungssatz fehlt'),
      PRAESENS,
      feature('Kommt der Text ohne wörtliche Rede aus?', 'Keine wörtliche Rede'),
      feature('Kommt der Text ohne persönliche Wertung aus?', 'Keine persönliche Wertung'),
    ],
  },
  {
    name: 'Charakterisierung',
    aliases: ['Figurencharakterisierung', 'Personencharakterisierung', 'Character analysis'],
    features: [
      feature('Nennt die Einleitung Titel, Autor und die Figur?', 'Einleitung fehlt'),
      feature(
        'Werden äußere Merkmale oder Lebensumstände der Figur genannt?',
        'Äußere Merkmale fehlen',
      ),
      feature('Werden Eigenschaften und Verhalten der Figur beschrieben?', 'Eigenschaften fehlen'),
      TEXTBELEG,
      PRAESENS,
    ],
  },
  {
    name: 'Textinterpretation',
    aliases: [
      'Interpretation',
      'Gedichtinterpretation',
      'Gedichtanalyse',
      'Kurzgeschichteninterpretation',
      'Szenenanalyse',
      'Commentaire de texte',
      'Comentario de texto',
    ],
    features: [
      feature('Nennt die Einleitung Titel, Autor, Textsorte und Thema?', 'Einleitung fehlt'),
      TEXTBELEG,
      PRAESENS,
      SCHLUSS,
    ],
  },
  {
    name: 'Sachtextanalyse',
    aliases: ['Textanalyse', 'Sachtextuntersuchung', 'Redeanalyse', 'Analyse eines Sachtexts'],
    features: [
      feature(
        'Nennt die Einleitung Titel, Autor, Quelle, Textsorte und Thema?',
        'Einleitung fehlt',
      ),
      TEXTBELEG,
      PRAESENS,
      SCHLUSS,
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
    aliases: ['Wegbeschreibung', 'Gegenstandsbeschreibung', 'Tierbeschreibung', 'Steckbrief'],
    features: [
      SACHLICH_PRAESENS,
      feature(
        'Enthält der Text genaue Angaben, etwa zu Lage, Aussehen oder Richtung?',
        'Genaue Angaben fehlen',
      ),
    ],
  },
  {
    name: 'Bildbeschreibung',
    aliases: ['Gemäldebeschreibung', 'Picture description', 'Description d’image'],
    features: [
      feature('Nennt die Einleitung Titel, Künstler und Art des Bildes?', 'Bildangaben fehlen'),
      feature(
        'Ordnet der Text Einzelheiten mit Ortsangaben ein, etwa vorne, hinten, links oder rechts?',
        'Ortsangaben fehlen',
      ),
      SACHLICH_PRAESENS,
    ],
  },
  {
    name: 'Personenbeschreibung',
    aliases: ['Täterbeschreibung', 'Vermisstenanzeige'],
    features: [
      feature(
        'Nennt der Text zuerst den Gesamteindruck, etwa Alter, Größe und Statur?',
        'Gesamteindruck fehlt',
      ),
      feature(
        'Beschreibt der Text Einzelheiten wie Gesicht, Haare und Kleidung?',
        'Einzelheiten fehlen',
      ),
      SACHLICH_PRAESENS,
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
      'Story',
      'Narrative',
      'Récit',
      'Narración',
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
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
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

const MIN_COMPOUND_PART = 5;
const MIN_COMPOUND_REST = 4;

const nameWords = (name: string) =>
  name
    .split(/[^\p{L}\p{N}]+/u)
    .map(normalizeFormName)
    .filter(Boolean);

const NAME_WORDS = TEXT_FORMS.flatMap((form) =>
  [form.name, ...form.aliases].map((name) => ({ form, words: nameWords(name) })),
);

function wordMatch(word: string, part: string): boolean {
  if (word === part) return true;
  if (part.length < MIN_COMPOUND_PART) return false;
  if (word.endsWith(part)) return word.length - part.length >= 2;
  return (
    word.startsWith(part) &&
    word.slice(part.length).replace(/^e?s/u, '').length >= MIN_COMPOUND_REST
  );
}

function sequenceMatch(words: readonly string[], parts: readonly string[]): boolean {
  if (parts.length === 1) return words.some((word) => wordMatch(word, parts[0] ?? ''));
  return words.some((_, start) => parts.every((part, offset) => words[start + offset] === part));
}

export function matchTextForm(name: string): TextForm | null {
  const exact = findTextForm(name);
  if (exact !== null) return exact;
  const words = nameWords(name);
  let best: { form: TextForm; length: number } | null = null;
  for (const entry of NAME_WORDS) {
    const length = entry.words.join('').length;
    if (length > (best?.length ?? 0) && sequenceMatch(words, entry.words)) {
      best = { form: entry.form, length };
    }
  }
  return best?.form ?? null;
}

export const FORM_SUGGESTIONS: readonly string[] = TEXT_FORMS.flatMap((form) => [
  form.name,
  ...form.aliases,
]);
