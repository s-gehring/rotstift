// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { parseTranscript } from '../annotations/parse.ts';
import { serializeTranscript } from '../annotations/serialize.ts';
import { correctPage } from './correct-page.ts';
import { createFakeCorrector } from './fake-corrector.ts';

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
    expect(corrector.calls).toEqual([{ lines: ['Hallo Welt', ''], profile: DEUTSCH }]);
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
});
