import { DEUTSCH, ENGLISCH, type CorrectionProfile } from '../annotations/profile.ts';
import type { Transcript } from '../annotations/transcript.ts';
import { FIXTURE_PAGE, roomyPage, tightPage } from '../overlay/fixtures.ts';
import { computeStatistics } from '../stats/statistics.ts';
import { defaultWeighting } from '../stats/weighting.ts';
import type { ClassArbeit, CorrectedArbeit, ExportPage, WordCountArbeit } from './types.ts';
import { syntheticScan } from './test-support.ts';

export const FIXED_DATE = new Date(2026, 9, 20, 12, 0, 0);

export const LANDSCAPE = { width: 1754, height: 1240 };

export function plainTranscript(text: string): Transcript {
  return {
    lines: text.split('\n').map((line, index) => ({
      number: index + 1,
      bbox: { x: 150, y: 260 + index * 110, width: 860, height: 60 },
      text: line,
      marks: [],
    })),
  };
}

export async function markedPage(transcript: Transcript = roomyPage()): Promise<ExportPage> {
  return {
    image: await syntheticScan(FIXTURE_PAGE, transcript),
    ...FIXTURE_PAGE,
    transcript,
  };
}

export async function bareScan(
  size = FIXTURE_PAGE,
  format: 'png' | 'jpeg' = 'png',
): Promise<ExportPage> {
  return { image: await syntheticScan(size, undefined, format), ...size };
}

export async function correctedArbeit(
  title = 'Müller, Jörg',
  profile: CorrectionProfile = DEUTSCH,
): Promise<CorrectedArbeit> {
  const first = roomyPage();
  const second = tightPage();
  return {
    title,
    profile,
    pages: [await markedPage(first), await markedPage(second), await bareScan()],
    statistics: computeStatistics({ lines: [...first.lines, ...second.lines] }),
    weighting: defaultWeighting(profile),
  };
}

export async function wordCountArbeit(title = 'Schmidt, Anna'): Promise<WordCountArbeit> {
  return {
    title,
    pages: [
      await markedPage(plainTranscript('Eins zwei drei vier\nfünf sechs')),
      await bareScan(),
      await markedPage(plainTranscript('Sieben acht neun')),
    ],
  };
}

export { ENGLISCH };
export type { ClassArbeit };
