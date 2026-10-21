// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseNotes, serializeNotes, type PageNotes } from './notes.ts';

describe('page notes', () => {
  it('round-trips comments and the summary', () => {
    const notes: PageNotes = {
      comments: [
        { line: 1, kind: 'form', text: 'Ort und Datum fehlen' },
        { line: 7, kind: 'content', text: 'Thema <verfehlt> & Co' },
      ],
      summary: 'Inhalt: Thema verfehlt. Form: Ort und Datum fehlen.',
    };
    const html = serializeNotes(notes);
    expect(html).toBe(
      [
        '<rs-comment n="1" kind="form">Ort und Datum fehlen</rs-comment>',
        '<rs-comment n="7" kind="content">Thema &lt;verfehlt&gt; &amp; Co</rs-comment>',
        '<rs-summary>Inhalt: Thema verfehlt. Form: Ort und Datum fehlen.</rs-summary>',
      ].join('\n'),
    );
    expect(parseNotes(html)).toEqual({ ok: true, notes });
  });

  it('writes nothing without findings', () => {
    expect(serializeNotes({ comments: [], summary: null })).toBe('');
    expect(parseNotes('')).toEqual({ ok: true, notes: { comments: [], summary: null } });
  });

  it('reports every problem at once', () => {
    const result = parseNotes(
      [
        '<rs-comment n="0" kind="style">x</rs-comment>',
        '<rs-comment n="2" kind="form" extra="1">y</rs-comment>',
        '<rs-comment n="3" kind="form"> </rs-comment>',
        '<rs-error type="R" fix="a">b</rs-error>',
        'lose',
        '<rs-summary>a</rs-summary><rs-summary>b</rs-summary>',
      ].join(''),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((issue) => issue.message)).toEqual([
      'Das Attribut n muss eine positive ganze Zahl sein.',
      'Das Attribut kind muss „content“ oder „form“ sein.',
      'Unbekanntes Attribut.',
      '<rs-comment> darf nicht leer sein.',
      'Unerwartetes Element <rs-error>.',
      'Text außerhalb von <rs-comment> und <rs-summary> ist ungültig.',
      'Es gibt höchstens ein <rs-summary>.',
    ]);
  });
});
