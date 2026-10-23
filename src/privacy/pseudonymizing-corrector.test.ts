// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import type { ContentInput } from '../content-form/review.ts';
import { correctPage } from '../correction/correct-page.ts';
import { createFakeCorrector } from '../correction/fake-corrector.ts';
import { DEFAULT_SCOPE } from '../correction/scope.ts';
import {
  PRIVACY_FAILED_MESSAGE,
  withPseudonymization,
  type PrivacyWorkPage,
} from './pseudonymizing-corrector.ts';
import type { IdentifierSpan } from './types.ts';

const person = (line: number, offset: number, length: number): IdentifierSpan => ({
  kind: 'identifier',
  category: 'person',
  source: 'name-list',
  line,
  offset,
  length,
});

const FIRST = ['Liebe Oma, hier schreibt Mia', 'Schulz aus 34127 Kassel.'];
const SECOND = ['Mia hat ire Hausaufgaben', 'vergesen.'];
const PAGES: readonly PrivacyWorkPage[] = [
  {
    pageId: 'p1',
    lines: FIRST,
    spans: [
      person(1, 25, 3),
      person(2, 0, 6),
      { ...person(2, 11, 12), category: 'place', source: 'rule' },
    ],
  },
  { pageId: 'p2', lines: SECOND, spans: [person(1, 0, 3)] },
];
const signal = new AbortController().signal;

const input = (lines: ContentInput['lines']): ContentInput => ({
  lines,
  profile: DEUTSCH,
  scope: { ...DEFAULT_SCOPE, content: true, assignment: 'Schreibe einen Brief.' },
});

describe('withPseudonymization', () => {
  it('sends pseudonymized lines and returns corrections on the original', async () => {
    const inner = createFakeCorrector((lines) =>
      lines.join('\n').replace('ire', 'ihre').replace('vergesen', 'vergessen'),
    );
    const corrector = withPseudonymization(inner, PAGES);
    const result = await correctPage({ lines: SECOND, profile: DEUTSCH, corrector });

    expect(inner.calls.map((call) => call.lines)).toEqual([
      ['[Person 1] hat ire Hausaufgaben', 'vergesen.'],
    ]);
    if (!result.ok) throw new Error(result.error.kind);
    expect(result.transcript.lines.map((line) => line.text)).toEqual(SECOND);
    expect(
      result.transcript.lines.map((line) => line.marks.map((mark) => [mark.original, mark.offset])),
    ).toEqual([[['ire', 8]], [['vergesen', 0]]]);
  });

  it('numbers placeholders across all pages of the work', async () => {
    const inner = createFakeCorrector((lines) => lines.join('\n'));
    const corrector = withPseudonymization(inner, PAGES);
    await corrector.correct(FIRST, DEUTSCH, signal);
    expect(inner.calls[0]?.lines).toEqual([
      'Liebe Oma, hier schreibt [Person 1]',
      '[Person 2] aus [Ort 1].',
    ]);
  });

  it('passes profile and scope through', async () => {
    const inner = createFakeCorrector((lines) => lines.join('\n'));
    const scope = { ...DEFAULT_SCOPE, grammar: false };
    await withPseudonymization(inner, PAGES).correct(SECOND, DEUTSCH, signal, scope);
    expect(inner.calls[0]?.profile).toBe(DEUTSCH);
    expect(inner.calls[0]?.scope).toBe(scope);
  });

  it('refuses unknown lines without calling the inner corrector', async () => {
    const inner = createFakeCorrector((lines) => lines.join('\n'));
    const result = await withPseudonymization(inner, PAGES).correct(
      ['Mia hat ire Hausaufgaben'],
      DEUTSCH,
      signal,
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: PRIVACY_FAILED_MESSAGE },
    });
    expect(inner.calls).toEqual([]);
  });

  it('passes errors of the inner corrector through', async () => {
    const inner = createFakeCorrector({ error: { kind: 'unavailable', message: 'offline' } });
    expect(await withPseudonymization(inner, PAGES).correct(SECOND, DEUTSCH, signal)).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'offline' },
    });
  });

  it('offers no review when the inner corrector has none', () => {
    const inner = createFakeCorrector('');
    expect(Object.hasOwn(withPseudonymization(inner, PAGES), 'review')).toBe(false);
  });

  it('pseudonymizes the review and restores names in comments', async () => {
    const inner = createFakeCorrector('', (sent) => ({
      ok: true,
      questions: 1,
      comments: [
        {
          pageId: 'p1',
          line: 2,
          kind: 'content',
          text: `${sent.lines[1]?.text.slice(0, 10) ?? ''} fehlt`,
        },
      ],
    }));
    const corrector = withPseudonymization(inner, PAGES);
    const result = await corrector.review?.(
      input([
        { pageId: 'p1', line: 1, text: FIRST[0] ?? '' },
        { pageId: 'p1', line: 2, text: FIRST[1] ?? '' },
        { pageId: 'p2', line: 1, text: SECOND[0] ?? '' },
      ]),
      signal,
    );
    expect(inner.reviews[0]?.lines.map((line) => line.text)).toEqual([
      'Liebe Oma, hier schreibt [Person 1]',
      '[Person 2] aus [Ort 1].',
      '[Person 1] hat ire Hausaufgaben',
    ]);
    expect(inner.reviews[0]?.scope.assignment).toBe('Schreibe einen Brief.');
    expect(result).toEqual({
      ok: true,
      questions: 1,
      comments: [{ pageId: 'p1', line: 2, kind: 'content', text: 'Schulz fehlt' }],
    });
  });

  it('refuses a review with unknown lines without calling the inner reviewer', async () => {
    const inner = createFakeCorrector('', () => ({ ok: true, questions: 0, comments: [] }));
    const result = await withPseudonymization(inner, PAGES).review?.(
      input([{ pageId: 'p1', line: 1, text: 'Liebe Oma, hier schreibt Mia Schulz' }]),
      signal,
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: PRIVACY_FAILED_MESSAGE },
    });
    expect(inner.reviews).toEqual([]);
  });
});
