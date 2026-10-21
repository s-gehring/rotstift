// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { parseTranscript } from '../annotations/parse.ts';
import { serializeTranscript } from '../annotations/serialize.ts';
import { correctPage } from './correct-page.ts';
import { createFakeCorrector } from './fake-corrector.ts';
import { DEFAULT_SCOPE, type CorrectionScope } from './scope.ts';

const LINES = ['Wir sind früh losgefahren weil mein Bruder die', 'Rutche ausprobieren wollte.'];
const CORRECTED = 'Wir sind früh losgefahren, weil mein Bruder die Rutsche ausprobieren wollte.';

describe('correctPage', () => {
  it('builds a valid transcript with marks, bboxes and statistics', async () => {
    const bbox = { x: 10, y: 20, width: 300, height: 30 };
    const result = await correctPage({
      lines: LINES,
      bboxes: [bbox, undefined],
      profile: DEUTSCH,
      corrector: createFakeCorrector(CORRECTED),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transcript.lines[0]?.bbox).toEqual(bbox);
    expect(result.transcript.lines[1]?.bbox).toBeUndefined();
    expect(result.transcript.lines.map((line) => line.marks.map((mark) => mark.type))).toEqual([
      ['Z'],
      ['R'],
    ]);
    expect(result.statistics).toMatchObject({ words: 11, errors: 2, errorsByType: { Z: 1, R: 1 } });
    expect(result.correctedText).toBe(CORRECTED);
    expect(result.droppedMarks).toBe(0);
  });

  it('produces a transcript that survives the HTML round trip', async () => {
    const result = await correctPage({
      lines: LINES,
      profile: DEUTSCH,
      corrector: createFakeCorrector(CORRECTED),
    });
    if (!result.ok) throw new Error('expected success');
    const html = serializeTranscript(result.transcript);
    const parsed = parseTranscript(html, { profile: DEUTSCH });
    expect(parsed).toEqual({ ok: true, transcript: result.transcript });
  });

  it('hands the normalized lines and the profile to the corrector', async () => {
    const corrector = createFakeCorrector((lines) => lines.join(' '));
    await correctPage({ lines: ['  Hallo   Welt ', ''], profile: DEUTSCH, corrector });
    expect(corrector.calls).toEqual([
      { lines: ['Hallo Welt', ''], profile: DEUTSCH, scope: DEFAULT_SCOPE },
    ]);
  });

  it('keeps only the marks of the requested kinds', async () => {
    const lines = ['Die Kinder spielt im Garten weil', 'die Sone scheint.'];
    const corrected = 'Die Kinder spielen im Garten, weil die Sonne scheint.';
    const typesFor = async (scope: CorrectionScope) => {
      const result = await correctPage({
        lines,
        profile: DEUTSCH,
        scope,
        corrector: createFakeCorrector(corrected),
      });
      if (!result.ok) throw new Error('expected success');
      return {
        marks: result.transcript.lines.flatMap((line) => line.marks.map((mark) => mark.type)),
        counted: Object.keys(result.statistics.errorsByType),
      };
    };
    const all = await typesFor(DEFAULT_SCOPE);
    expect(all).toEqual({ marks: ['G', 'Z', 'R'], counted: ['G', 'Z', 'R'] });
    expect(await typesFor({ ...DEFAULT_SCOPE, grammar: false })).toEqual({
      marks: ['Z', 'R'],
      counted: ['Z', 'R'],
    });
    expect(await typesFor({ ...DEFAULT_SCOPE, spelling: false })).toEqual({
      marks: ['G'],
      counted: ['G'],
    });
  });

  it('keeps empty lines in place', async () => {
    const result = await correctPage({
      lines: ['Eins', '', 'Zwei'],
      profile: DEUTSCH,
      corrector: createFakeCorrector('Eins\n\nZwei'),
    });
    if (!result.ok) throw new Error('expected success');
    expect(result.transcript.lines.map((line) => line.number)).toEqual([1, 2, 3]);
  });

  it('skips the corrector for a page without text', async () => {
    const corrector = createFakeCorrector('egal');
    const result = await correctPage({ lines: ['', ' '], profile: DEUTSCH, corrector });
    expect(corrector.calls).toEqual([]);
    expect(result.ok && result.statistics.words).toBe(0);
  });

  it('passes corrector errors through', async () => {
    const result = await correctPage({
      lines: LINES,
      profile: DEUTSCH,
      corrector: createFakeCorrector({ error: { kind: 'unavailable', message: 'weg' } }),
    });
    expect(result).toEqual({ ok: false, error: { kind: 'unavailable', message: 'weg' } });
  });

  it('reports a fixed message and keeps the details apart', async () => {
    const result = await correctPage({
      lines: ['Eins'],
      bboxes: [{ x: 0, y: 0, width: -1, height: 1 }],
      profile: DEUTSCH,
      corrector: createFakeCorrector('Eins'),
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: 'failed',
        message: 'Die Korrekturmarkierungen konnten nicht erstellt werden',
      },
    });
    if (result.ok || result.error.kind !== 'failed') throw new Error('expected failure');
    expect(result.error.detail).toContain('Breite');
  });

  it('applies the collapse limit', async () => {
    const result = await correctPage({
      lines: ['Der alte Mann geht heim.'],
      profile: DEUTSCH,
      corrector: createFakeCorrector('Ein älterer Herr ging nach Hause.'),
      maxChangedRun: 10,
    });
    if (!result.ok) throw new Error('expected success');
    expect(result.transcript.lines[0]?.marks.length).toBeGreaterThan(1);
  });

  it('hides struck words from the corrector, keeps them in the text and does not count them', async () => {
    const corrector = createFakeCorrector(
      'Wir sind früh losgefahren, weil mein Bruder\ndie Rutsche ausprobieren wollte.',
    );
    const result = await correctPage({
      lines: [
        'Wir sind ~~spät~~ früh losgefahren weil mein ~~Brder~~ Bruder',
        'die Rutche ausprobieren ~~wolte~~ wollte.',
      ],
      profile: DEUTSCH,
      corrector,
    });
    expect(corrector.calls[0]?.lines).toEqual([
      'Wir sind früh losgefahren weil mein Bruder',
      'die Rutche ausprobieren wollte.',
    ]);
    if (!result.ok) throw new Error('expected success');
    const [first, second] = result.transcript.lines;
    expect(first).toMatchObject({
      text: 'Wir sind spät früh losgefahren weil mein Brder Bruder',
      struck: [
        { offset: 9, text: 'spät' },
        { offset: 41, text: 'Brder' },
      ],
      marks: [{ kind: 'omission', correction: ',', offset: 30 }],
    });
    expect(second?.marks).toMatchObject([{ original: 'Rutche', correction: 'Rutsche', offset: 4 }]);
    expect(result.statistics.words).toBe(11);
    const reparsed = parseTranscript(serializeTranscript(result.transcript), { profile: DEUTSCH });
    expect(reparsed).toEqual({ ok: true, transcript: result.transcript });
  });
});

describe('correctPage without spelling and grammar', () => {
  it('does not call the corrector and leaves the transcript without marks', async () => {
    const corrector = createFakeCorrector('Anderer Text');
    const result = await correctPage({
      lines: ['Das ist ein Text', 'Und noch einer'],
      profile: DEUTSCH,
      scope: { ...DEFAULT_SCOPE, spelling: false, grammar: false, content: true, assignment: 'A' },
      corrector,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(corrector.calls).toHaveLength(0);
    expect(result.transcript.lines.map((line) => line.text)).toEqual([
      'Das ist ein Text',
      'Und noch einer',
    ]);
    expect(result.transcript.lines.every((line) => line.marks.length === 0)).toBe(true);
    expect(result.statistics.errors).toBe(0);
  });
});
