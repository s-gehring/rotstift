import type { PageComment } from '../overlay/layout.ts';
import type { PageMargins } from '../overlay/model.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';
import type { Transcript } from '../annotations/transcript.ts';
import type { Grading } from '../stats/grading.ts';
import type { Statistics } from '../stats/statistics.ts';
import type { Weighting } from '../stats/weighting.ts';

export interface ExportPage {
  readonly image: Blob;
  readonly width: number;
  readonly height: number;
  readonly transcript?: Transcript;
  readonly comments?: readonly PageComment[];
  readonly summary?: string | null;
  readonly margins?: PageMargins;
}

export interface ContentNote {
  readonly page: number;
  readonly line: number;
  readonly text: string;
  readonly coveredBy?: string;
}

export interface ContentReport {
  readonly comments: readonly ContentNote[];
  readonly summary: string | null;
}

export interface CorrectedArbeit {
  readonly title: string;
  readonly pages: readonly ExportPage[];
  readonly profile: CorrectionProfile;
  readonly statistics: Statistics;
  readonly weighting: Weighting;
  readonly grading?: Grading;
  readonly content?: ContentReport;
}

export interface WordCountArbeit {
  readonly title: string;
  readonly pages: readonly ExportPage[];
  readonly words?: readonly (number | null)[];
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
  readonly footer?: string;
  readonly onProgress?: (done: number, total: number) => void;
  readonly signal?: AbortSignal;
}

export interface ClassExportOptions extends ExportOptions {
  readonly title?: string;
}
