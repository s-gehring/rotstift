import type { SetupRole } from '../app/types.ts';

export const ROLE_NAME: Readonly<Record<SetupRole, string>> = {
  transcriber: 'Texterkennung',
  corrector: 'Korrektur',
  reviewer: 'Inhalt und Form',
  secondReader: 'Zweite Lesung',
};
