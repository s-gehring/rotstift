import { describe, expect, it } from 'vitest';
import { median, overviewTable, summarize, wordCountByPageTable } from './report.ts';
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
      image: 'brief--caveat.jpg',
      seconds: 10,
      expectedWords: 100,
      transcribedWords: 98,
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
    page({
      image: 'brief--grundschrift.jpg',
      seconds: 30,
      expectedWords: 50,
      transcribedWords: 50,
      charEdits: 3,
      charCount: 300,
      wordEdits: 3,
      wordCount: 60,
    }),
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

  it('averages the word count deviation per page', () => {
    const summary = summarize(run);
    expect(summary.wordCountError).toBeCloseTo(0.01);
    expect(summary.wordCountMaxError).toBeCloseTo(0.02);
    expect(summary.wordCountExact).toBe(0.5);
  });

  it('marks missing word counts instead of guessing', () => {
    const summary = summarize({ ...run, pages: [page({})] });
    expect(summary.wordCountError).toBeNaN();
    expect(overviewTable([summary])).toContain('n. v.');
  });

  it('renders one table row per model', () => {
    const table = overviewTable([summarize(run)]).split('\n');
    expect(table).toHaveLength(3);
    expect(table[2]).toContain('| Modell | 2 | 2.50 | 4.20 |');
    expect(table[2]).toContain('1.0 %');
  });
});

describe('wordCountByPageTable', () => {
  it('shows the signed deviation per page and model', () => {
    const rows = wordCountByPageTable([run, { ...run, label: 'Andere', pages: run.pages.slice(1) }])
      .split('\n')
      .slice(2);
    expect(rows).toEqual([
      '| brief--caveat | 100 | -2 | n. v. |',
      '| brief--grundschrift | 50 | 0 | 0 |',
    ]);
  });
});
