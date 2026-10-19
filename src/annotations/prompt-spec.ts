import { CATALOG, findErrorKind } from './catalog.ts';
import type { ErrorExample, ErrorKind } from './catalog.ts';
import type { CorrectionProfile } from './profile.ts';
import { serializeLine } from './serialize.ts';

export function renderExample(kind: ErrorKind): string {
  const { before, original, correction, after }: ErrorExample = kind.example;
  return serializeLine({
    number: 1,
    text: before + original + after,
    marks: [
      {
        kind: original === '' ? 'omission' : 'error',
        type: kind.code,
        original,
        correction,
        offset: before.length,
      },
    ],
  });
}

export function buildSpecification(profile: CorrectionProfile): string {
  const kinds = profile.allowedTypes.map((code) => {
    const kind = findErrorKind(profile.language, code);
    if (!kind) {
      throw new Error(
        `Fehlerart „${code}“ fehlt im Katalog für ${CATALOG[profile.language].name}.`,
      );
    }
    return kind;
  });

  const kindLines = kinds.map(
    (kind) =>
      `- ${kind.code} (${kind.name}): ${kind.description}\n  Beispiel: ${renderExample(kind)}`,
  );

  return [
    `Markiere in den Zeilen der Schülerarbeit alle Fehler der unten genannten Fehlerarten. Fach: ${profile.subject}, Sprache: ${CATALOG[profile.language].name}.`,
    '',
    'Format:',
    '- Gib ausschließlich <rs-line>-Elemente aus, eine pro Eingabezeile, in derselben Reihenfolge. Übernimm die Attribute n und bbox unverändert. Kein Text außerhalb der Zeilen, keine Erklärungen, keine anderen HTML-Elemente.',
    '- Schreibe den Text jeder Zeile unverändert ab. Korrigiere ihn nicht, sondern markiere nur.',
    '- Ein fehlerhafter Textteil: <rs-error type="KÜRZEL" fix="KORREKTUR">Originaltext</rs-error>. Das Attribut fix enthält den richtigen Ersatz für genau den markierten Text. Ist der markierte Text überflüssig, ist fix="".',
    '- Etwas fehlt (Zeichen oder Wort): <rs-missing type="KÜRZEL" fix="FEHLENDER TEXT"></rs-missing> an der Stelle, an der es fehlt. Das schließende Tag ist immer nötig.',
    '- Markiere die kürzeste Textstelle, an der der Fehler zu erkennen ist. Markierungen dürfen sich nicht überlappen und nicht ineinander stehen.',
    '- Verwende nur die unten genannten Kürzel. Enthält eine Zeile keinen Fehler, bleibt sie ohne Markierung.',
    '',
    'Fehlerarten:',
    ...kindLines,
  ].join('\n');
}
