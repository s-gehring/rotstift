// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { correctPage } from './correct-page.ts';
import { createPreviewCorrector, previewCorrection, previewReview } from './preview-corrector.ts';
import { DEFAULT_SCOPE } from './scope.ts';

const LINES = [
  'Vorschautext Platzhalter dieser Zeile 1',
  'Vorschautext Platzhalter dieser Zeile 2',
  'Vorschautext Platzhalter dieser Zeile 3',
];

describe('previewCorrection', () => {
  it('changes the placeholder text so that marks appear', async () => {
    expect(previewCorrection(LINES)).not.toBe(LINES.join('\n'));
    const result = await correctPage({
      lines: LINES,
      profile: DEUTSCH,
      corrector: createPreviewCorrector({ delayMs: 0 }),
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.statistics.errors).toBeGreaterThan(0);
  });
});

describe('createPreviewCorrector', () => {
  it('stops when cancelled', async () => {
    const abort = new AbortController();
    const pending = createPreviewCorrector({ delayMs: 10_000 }).correct(
      LINES,
      DEUTSCH,
      abort.signal,
    );
    abort.abort();
    await expect(pending).resolves.toEqual({ ok: false, error: { kind: 'cancelled' } });
  });
});

describe('previewReview', () => {
  const lines = [
    { pageId: 'p1', line: 1, text: 'Erste' },
    { pageId: 'p1', line: 2, text: '' },
    { pageId: 'p1', line: 3, text: 'Zweite' },
    { pageId: 'p1', line: 4, text: 'Dritte' },
  ];

  it('comments on form at the first and content at the middle written line', () => {
    const result = previewReview({
      lines,
      profile: DEUTSCH,
      scope: {
        ...DEFAULT_SCOPE,
        form: true,
        formName: 'Leserbrief',
        content: true,
        assignment: 'A',
      },
    });
    expect(result).toEqual({
      ok: true,
      comments: [
        { pageId: 'p1', line: 1, kind: 'form', text: 'Bezug zum Artikel fehlt' },
        { pageId: 'p1', line: 3, kind: 'content', text: 'Vorgabe der Aufgabe fehlt' },
      ],
      questions: 6,
    });
  });

  it('gives no comments when nothing is requested', () => {
    expect(previewReview({ lines, profile: DEUTSCH, scope: DEFAULT_SCOPE })).toEqual({
      ok: true,
      comments: [],
      questions: 0,
    });
  });
});
