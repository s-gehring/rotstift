// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildCorrectedPdf, buildWordCountPdf } from './build-pdf.ts';
import { correctedArbeit, FIXED_DATE, wordCountArbeit } from './fixtures.ts';
import { encodePageImage, JPEG_QUALITY, MAX_EDGE } from './page-image.ts';
import { installCanvas } from './test-support.ts';

vi.mock('../import/canvas.ts', () => import('./test-support.ts').then((m) => m.canvasModule));
vi.mock('../overlay/font.ts', () => import('./test-support.ts').then((m) => m.fontModule));

beforeAll(installCanvas);

const KIB = 1024;
const PAGE_BUDGET = 450 * KIB;
const OVERHEAD_BUDGET = 40 * KIB;

describe('size budget', () => {
  it('keeps the encoding settings the budget was measured with', () => {
    expect(JPEG_QUALITY).toBe(0.82);
    expect(MAX_EDGE).toBe(2048);
  });

  it('stays below the budget per marked page', async () => {
    const arbeit = await correctedArbeit();
    for (const page of arbeit.pages) {
      const { bytes } = await encodePageImage(page, arbeit.profile);
      expect(bytes.length).toBeLessThan(PAGE_BUDGET);
    }
  });

  it('keeps a corrected PDF within the page budget plus a small overhead', async () => {
    const arbeit = await correctedArbeit();
    const bytes = await buildCorrectedPdf(arbeit, { date: FIXED_DATE });
    expect(bytes.length).toBeLessThan(arbeit.pages.length * PAGE_BUDGET + OVERHEAD_BUDGET);
    const pngBytes = arbeit.pages.reduce((sum, page) => sum + page.image.size, 0);
    expect(bytes.length).toBeLessThan(pngBytes / 2);
  });

  it('keeps a word count PDF within the page budget plus a small overhead', async () => {
    const arbeit = await wordCountArbeit();
    const bytes = await buildWordCountPdf(arbeit, { date: FIXED_DATE });
    expect(bytes.length).toBeLessThan(arbeit.pages.length * PAGE_BUDGET + OVERHEAD_BUDGET);
  });
});
