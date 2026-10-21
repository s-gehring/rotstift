import type { ModelRole } from '../app/types.ts';

export const ROLE_NAME: Readonly<Record<ModelRole, string>> = {
  transcriber: 'Texterkennung',
  corrector: 'Korrektur',
  reviewer: 'Inhalt und Form',
};
