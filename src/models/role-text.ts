import type { AnyModelInfo } from './registry.ts';

export interface RoleText {
  readonly title: string;
  readonly manage: string;
  readonly intro: string;
  readonly ready: string;
  readonly slow: string;
  readonly afterDelete: string;
  readonly choice: string;
  readonly choiceLocked: string;
}

const TEXT: Readonly<Record<AnyModelInfo['role'], RoleText>> = {
  transcriber: {
    title: 'Texterkennung einrichten',
    manage: 'Texterkennung verwalten',
    intro:
      'Rotstift liest die Handschrift mit einem KI-Modell, das auf diesem Rechner läuft. Dieses Modell muss einmal heruntergeladen werden.',
    ready: 'Die Texterkennung ist eingerichtet. Wörter zählen funktioniert jetzt ohne Internet.',
    slow: 'Die Texterkennung kann sehr langsam sein oder abbrechen.',
    afterDelete: 'Zum Wörterzählen muss es danach erneut heruntergeladen werden.',
    choice: 'Welches Modell soll Wörter zählen?',
    choiceLocked: 'Während Wörter gezählt werden, kann das Modell nicht gewechselt werden.',
  },
  corrector: {
    title: 'Korrektur einrichten',
    manage: 'Korrektur verwalten',
    intro:
      'Rotstift findet Fehler in Rechtschreibung, Zeichensetzung und Grammatik mit einem zweiten KI-Modell, das auf diesem Rechner läuft. Es wird erst zum Berichtigen gebraucht und muss einmal heruntergeladen werden.',
    ready: 'Die Korrektur ist eingerichtet. Berichtigen funktioniert jetzt ohne Internet.',
    slow: 'Die Korrektur kann sehr langsam sein oder abbrechen.',
    afterDelete: 'Zum Berichtigen muss es danach erneut heruntergeladen werden.',
    choice: 'Welches Modell soll berichtigen?',
    choiceLocked: 'Während berichtigt wird, kann das Modell nicht gewechselt werden.',
  },
};

export function roleText(model: AnyModelInfo): RoleText {
  return TEXT[model.role];
}
