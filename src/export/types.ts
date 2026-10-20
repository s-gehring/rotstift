import type { CorrectionProfile } from '../annotations/profile.ts';
import type { Transcript } from '../annotations/transcript.ts';
import type { Statistics } from '../stats/statistics.ts';

export interface ExportPage {
  readonly image: Blob;
  readonly width: number;
  readonly height: number;
  readonly transcript?: Transcript;
}

export interface CorrectedArbeit {
  readonly title: string;
  readonly pages: readonly ExportPage[];
  readonly profile: CorrectionProfile;
  readonly statistics: Statistics;
}

export interface WordCountArbeit {
  readonly title: string;
  readonly pages: readonly ExportPage[];
}

export type ClassArbeit =
  | ({ readonly kind: 'corrected' } & CorrectedArbeit)
  | ({ readonly kind: 'wordCount' } & WordCountArbeit);

export interface PageImage {
  readonly bytes: Uint8Array;
  readonly format: 'jpeg' | 'png';
}

export type PageImageEncoder = (
  page: ExportPage,
  profile: CorrectionProfile | undefined,
) => Promise<PageImage>;

export interface ExportOptions {
  readonly date?: Date;
  readonly encodePage?: PageImageEncoder;
}

export interface ClassExportOptions extends ExportOptions {
  readonly title?: string;
}
