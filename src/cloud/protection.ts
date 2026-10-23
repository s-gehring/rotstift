import type { ModelRole } from '../app/types.ts';
import type { CloudStep, CloudView } from './client.ts';
import { isLoopbackUrl } from './templates.ts';

export const PROTECTION_LABEL = 'Personenbezug vor dem Senden entfernen';
export const PROTECTED_RECOGNITION_NOTE = 'Bei eingeschaltetem Schutz läuft die Erkennung lokal.';
export const PROTECTION_ON_NOTE =
  'Rotstift ersetzt Namen und andere Kennungen durch Platzhalter, bevor Text an den Anbieter geht. Der Text ist danach pseudonymisiert.';
export const PROTECTION_OFF_TITLE = 'Personenbezug nicht entfernen?';
export const PROTECTION_OFF_TEXT =
  'Ohne Schutz sendet Rotstift Namen und andere persönliche Angaben aus den Schülerarbeiten unverändert an den Anbieter.';
export const PROTECTION_OFF_IMAGES =
  'Bei der Erkennung gehen außerdem die Seiten als Bilder mit der Handschrift der Schülerinnen und Schüler an den Anbieter. Auch Handschrift ist personenbezogen.';
export const PROTECTION_OFF_LIABILITY =
  'Schalten Sie den Schutz nur aus, wenn für diesen Anbieter ein Vertrag zur Auftragsverarbeitung besteht. Für die Einhaltung der DSGVO und aller anderen Gesetze sind Sie selbst verantwortlich.';

export function protectionApplies(steps: CloudView['steps'], role: ModelRole): boolean {
  return steps[role]?.protection === true;
}

export function protectionDefault(templateId: string, baseUrl: string): boolean {
  return templateId !== 'server' && !isLoopbackUrl(baseUrl);
}

export function stepProtectionDefault(step: CloudStep): boolean {
  return step.template !== 'server' && !step.loopback;
}

export function protectionSuffix(step: CloudStep, role: ModelRole): string {
  if (!step.protection) return '';
  return role === 'transcriber' ? ', gesperrt durch den Schutz' : ', pseudonymisiert';
}
