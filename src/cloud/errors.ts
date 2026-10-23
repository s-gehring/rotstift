export type CloudErrorClass =
  | 'notConfigured'
  | 'consentMissing'
  | 'protectionActive'
  | 'notPseudonymized'
  | 'protectionConsentMissing'
  | 'keyMissing'
  | 'invalidAddress'
  | 'insecure'
  | 'invalidRequest'
  | 'auth'
  | 'rateLimited'
  | 'notFound'
  | 'tooLarge'
  | 'badRequest'
  | 'server'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'invalidResponse'
  | 'storage';

export interface CloudError {
  readonly kind: 'cloud';
  readonly detail: CloudErrorClass;
}

export function isCloudError(value: unknown): value is CloudError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'cloud' &&
    'detail' in value &&
    typeof value.detail === 'string'
  );
}

const TEXT: Readonly<Record<CloudErrorClass, string>> = {
  notConfigured: 'Das Cloud-Modell ist nicht eingerichtet',
  consentMissing: 'Das Cloud-Modell ist nicht freigegeben',
  protectionActive: 'Bei eingeschaltetem Schutz läuft die Erkennung lokal',
  notPseudonymized: 'Der Text wurde nicht pseudonymisiert und wird nicht gesendet',
  protectionConsentMissing: 'Das Ausschalten des Schutzes ist nicht bestätigt',
  keyMissing: 'Für das Cloud-Modell fehlt der Schlüssel',
  invalidAddress: 'Die Adresse ist ungültig',
  insecure: 'Schlüssel und Daten gehen nur verschlüsselt (https) oder an ein lokales Netz',
  invalidRequest: 'Die Anfrage passt nicht zum Cloud-Modell',
  auth: 'Der Anbieter hat den Schlüssel abgelehnt',
  rateLimited: 'Der Anbieter nimmt gerade keine weiteren Anfragen an',
  notFound: 'Der Anbieter kennt dieses Modell nicht',
  tooLarge: 'Die Anfrage war dem Anbieter zu groß',
  badRequest: 'Der Anbieter hat die Anfrage abgelehnt',
  server: 'Der Anbieter hat einen Fehler gemeldet',
  network: 'Der Anbieter ist nicht erreichbar',
  timeout: 'Der Anbieter hat nicht rechtzeitig geantwortet',
  cancelled: 'Abgebrochen',
  invalidResponse: 'Die Antwort des Anbieters war unbrauchbar',
  storage: 'Die Einstellung ließ sich nicht speichern',
};

export function describeCloudError(error: CloudErrorClass): string {
  return TEXT[error];
}

const UNAVAILABLE: ReadonlySet<CloudErrorClass> = new Set([
  'notConfigured',
  'consentMissing',
  'protectionActive',
  'keyMissing',
  'auth',
]);

export function cloudUnavailable(error: CloudErrorClass): boolean {
  return UNAVAILABLE.has(error);
}
