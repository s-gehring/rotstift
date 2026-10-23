export type IdentifierCategory = 'person' | 'place' | 'institution' | 'contact' | 'date' | 'number';

export type SensitiveCategory =
  'health' | 'origin' | 'religion' | 'politics' | 'sexuality' | 'union' | 'circumstances';

export type PrivacySource = 'rule' | 'name-list' | 'model' | 'teacher';

interface SpanPosition {
  readonly line: number;
  readonly offset: number;
  readonly length: number;
  readonly source: PrivacySource;
}

export interface IdentifierSpan extends SpanPosition {
  readonly kind: 'identifier';
  readonly category: IdentifierCategory;
}

export interface SensitiveSpan extends SpanPosition {
  readonly kind: 'sensitive';
  readonly category: SensitiveCategory;
}

export type PrivacySpan = IdentifierSpan | SensitiveSpan;

export interface DetectorContext {
  readonly workName: string;
  readonly subject?: string;
  readonly language: string;
  readonly task?: string;
}

export type Detector = (
  lines: readonly string[],
  context: DetectorContext,
  signal: AbortSignal,
) => Promise<PrivacySpan[]>;

export const PLACEHOLDER_LABELS: Readonly<Record<IdentifierCategory, string>> = {
  person: 'Person',
  place: 'Ort',
  institution: 'Einrichtung',
  contact: 'Kontakt',
  date: 'Datum',
  number: 'Nummer',
};
