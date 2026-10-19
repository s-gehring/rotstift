import { describe, expect, it } from 'vitest';
import { median, overviewTable, summarize } from './report.ts';
import type { ModelRun, PageResult } from './report.ts';

const page = (overrides: Partial<PageResult>): PageResult => ({
  image: 'a--b.jpg',
  text: 'a',
  font: 'b',
  seconds: 10,
  promptTokens: 0,
  generatedTokens: 0,
  charEdits: 0,
  charCount: 100,
  wordEdits: 0,
  wordCount: 20,
  errors: [],
  transcript: '',
  ...overrides,
});

const run: ModelRun = {
  id: 'm',
  label: 'Modell',
  license: 'MIT',
  bytes: 2.5e9,
  threads: 4,
  contextSize: 8192,
  loadSeconds: 3,
  peakRssBytes: 4.2e9,
  pages: [
    page({
      seconds: 10,
      charEdits: 1,
      wordEdits: 1,
      errors: [
        { kind: 'R', written: 'das', correct: 'dass', transcribed: 'das', outcome: 'preserved' },
        {
          kind: 'R',
          written: 'wider',
          correct: 'wieder',
          transcribed: 'wieder',
          outcome: 'corrected',
        },
      ],
    }),
    page({ seconds: 30, charEdits: 3, charCount: 300, wordEdits: 3, wordCount: 60 }),
  ],
};

describe('median', () => {
  it('handles odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNaN();
  });
});

describe('summarize', () => {
  it('pools edits over all pages', () => {
    const summary = summarize(run);
    expect(summary.cer).toBeCloseTo(4 / 400);
    expect(summary.wer).toBeCloseTo(4 / 80);
    expect(summary.medianSecondsPerPage).toBe(20);
    expect(summary.preserved).toBe(0.5);
    expect(summary.corrected).toBe(0.5);
    expect(summary.peakRamGigabytes).toBeCloseTo(4.2);
  });

  it('renders one table row per model', () => {
    const table = overviewTable([summarize(run)]).split('\n');
    expect(table).toHaveLength(3);
    expect(table[2]).toContain('| Modell | 2.50 | 4.20 |');
    expect(table[2]).toContain('1.0 %');
  });
});
