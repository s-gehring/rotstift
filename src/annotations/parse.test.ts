// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { formatIssues, parseTranscript } from './parse.ts';
import type { ParseResult } from './parse.ts';
import { DEUTSCH, ENGLISCH, profileSchema } from './profile.ts';
import { serializeTranscript } from './serialize.ts';
import { listErrors } from './transcript.ts';

const WEEKEND_ESSAY = `
<rs-line n="1" bbox="40,60,720,34">Am Wochenende <rs-error type="Sb" fix="war ich">ich war</rs-error> mit meiner Familie im <rs-error type="R" fix="Schwimmbad">Schwimbad</rs-error>.</rs-line>
<rs-line n="2" bbox="40,104,720,34">Wir sind früh losgefahren<rs-missing type="Z" fix=","></rs-missing> weil mein Bruder die neue Rutsche ausprobieren wollte.</rs-line>
<rs-line n="3" bbox="40,148,720,34">Dort trafen wir mit <rs-error type="G" fix="meinem">meinen</rs-error> Onkel Peter zusammen.</rs-line>
<rs-line n="4" bbox="40,192,720,34">Danach <rs-error type="T" fix="aßen">essen</rs-error> wir Pommes und <rs-error type="W" fix="anschließend">danach</rs-error> gingen wir heim.</rs-line>
`;

function expectOk(result: ParseResult) {
  if (!result.ok) {
    throw new Error(formatIssues(result.issues));
  }
  return result.transcript;
}

function issuesOf(html: string, profile = DEUTSCH): string[] {
  const result = parseTranscript(html, { profile });
  return result.ok ? [] : result.issues.map((issue) => issue.message);
}

describe('parseTranscript with a realistic essay', () => {
  const transcript = expectOk(parseTranscript(WEEKEND_ESSAY, { profile: DEUTSCH }));

  it('extracts the lines with number, text and bounding box', () => {
    expect(transcript.lines.map((line) => line.number)).toEqual([1, 2, 3, 4]);
    expect(transcript.lines[0]?.text).toBe(
      'Am Wochenende ich war mit meiner Familie im Schwimbad.',
    );
    expect(transcript.lines[0]?.bbox).toEqual({ x: 40, y: 60, width: 720, height: 34 });
    expect(transcript.lines[3]?.bbox?.y).toBe(192);
  });

  it('extracts errors with type, original, correction, line and position', () => {
    const errors = listErrors(transcript);
    expect(errors).toHaveLength(6);
    expect(errors[0]).toEqual({
      kind: 'error',
      type: 'Sb',
      original: 'ich war',
      correction: 'war ich',
      offset: 14,
      line: 1,
    });
    const schwimbad = errors[1];
    expect(schwimbad?.original).toBe('Schwimbad');
    expect(schwimbad?.offset).toBe(transcript.lines[0]?.text.indexOf('Schwimbad'));
  });

  it('models a missing comma as an omission between the words', () => {
    const omission = transcript.lines[1]?.marks[0];
    expect(omission).toEqual({
      kind: 'omission',
      type: 'Z',
      original: '',
      correction: ',',
      offset: 'Wir sind früh losgefahren'.length,
    });
  });

  it('round-trips through the serializer', () => {
    const html = serializeTranscript(transcript);
    expect(expectOk(parseTranscript(html, { profile: DEUTSCH }))).toEqual(transcript);
  });
});

describe('parseTranscript with English text', () => {
  it('accepts English codes case-insensitively and normalizes them', () => {
    const html =
      '<rs-line n="1">I <rs-error type="SP" fix="received">recieved</rs-error> your letter yesterday and <rs-error type="Gr" fix="was">were</rs-error> happy.</rs-line>';
    const transcript = expectOk(parseTranscript(html, { profile: ENGLISCH }));
    expect(listErrors(transcript).map((error) => error.type)).toEqual(['sp', 'gr']);
  });

  it('rejects German codes for an English profile', () => {
    expect(
      issuesOf('<rs-line n="1"><rs-error type="Sb" fix="x">y</rs-error></rs-line>', ENGLISCH),
    ).toEqual([expect.stringContaining('Unbekannter Fehlertyp „Sb“')]);
  });
});

describe('parseTranscript tolerance', () => {
  it('collapses indentation and line breaks inside a line', () => {
    const html = `
      <rs-line n="1">
        Der Hund   <rs-error type="R" fix="rannte">rante</rs-error>
        durch den Garten.
      </rs-line>`;
    const transcript = expectOk(parseTranscript(html, { profile: DEUTSCH }));
    expect(transcript.lines[0]?.text).toBe('Der Hund rante durch den Garten.');
    expect(transcript.lines[0]?.marks[0]?.offset).toBe(9);
  });

  it('moves whitespace inside a marking out of the original text', () => {
    const html =
      '<rs-line n="1">Wir <rs-error type="R" fix="gehen"> gehn </rs-error> heim</rs-line>';
    const line = expectOk(parseTranscript(html, { profile: DEUTSCH })).lines[0];
    expect(line?.text).toBe('Wir gehn heim');
    expect(line?.marks[0]).toMatchObject({ original: 'gehn', offset: 4 });
  });

  it('decodes character references', () => {
    const html = '<rs-line n="1">Tom &amp; Anna lachen &lt;laut&gt;.</rs-line>';
    expect(expectOk(parseTranscript(html)).lines[0]?.text).toBe('Tom & Anna lachen <laut>.');
  });

  it('strips a markdown code fence around the output', () => {
    const html = '```html\n<rs-line n="1">Hallo Welt</rs-line>\n```';
    expect(expectOk(parseTranscript(html)).lines[0]?.text).toBe('Hallo Welt');
  });

  it('accepts an empty correction for a superfluous word', () => {
    const html = '<rs-line n="1">Das ist <rs-error type="W" fix="">ist</rs-error> gut.</rs-line>';
    const mark = expectOk(parseTranscript(html, { profile: DEUTSCH })).lines[0]?.marks[0];
    expect(mark?.correction).toBe('');
  });

  it('accepts lines without a bounding box and with gaps in the numbering', () => {
    const html = '<rs-line n="2">Eins</rs-line><rs-line n="5">Zwei</rs-line>';
    const transcript = expectOk(parseTranscript(html));
    expect(transcript.lines.map((line) => line.number)).toEqual([2, 5]);
    expect(transcript.lines[0]?.bbox).toBeUndefined();
  });

  it('keeps an omission at the end of a line after trailing whitespace', () => {
    const html = '<rs-line n="1">Es regnet <rs-missing type="Z" fix="."></rs-missing> </rs-line>';
    const line = expectOk(parseTranscript(html, { profile: DEUTSCH })).lines[0];
    expect(line?.text).toBe('Es regnet');
    expect(line?.marks[0]?.offset).toBe(9);
  });

  it('works without a profile and then only checks the structure', () => {
    const html = '<rs-line n="1"><rs-error type="Xyz" fix="b">a</rs-error></rs-line>';
    expect(expectOk(parseTranscript(html)).lines[0]?.marks[0]?.type).toBe('Xyz');
  });
});

describe('parseTranscript rejects malformed output', () => {
  it('rejects unknown types and lists the allowed ones', () => {
    const [message] = issuesOf('<rs-line n="1"><rs-error type="Q" fix="b">a</rs-error></rs-line>');
    expect(message).toBe(
      '<rs-error>: Unbekannter Fehlertyp „Q“. Erlaubt sind: R, Z, G, A, Sb, T, Bz, W.',
    );
  });

  it('rejects types that the profile does not allow', () => {
    const profile = profileSchema.parse({
      ...DEUTSCH,
      id: 'x',
      name: 'Grundstufe',
      allowedTypes: ['R', 'Z'],
    });
    const html = '<rs-line n="2"><rs-error type="Bz" fix="b">a</rs-error></rs-line>';
    const result = parseTranscript(html, { profile });
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          line: 2,
          message:
            '<rs-error>: Der Fehlertyp „Bz“ ist im Profil „Grundstufe“ nicht erlaubt. Erlaubt sind: R, Z.',
        },
      ],
    });
  });

  it('rejects nested markings', () => {
    const html =
      '<rs-line n="1">Wir <rs-error type="Sb" fix="gingen wir">wir <rs-error type="R" fix="gingen">gingn</rs-error></rs-error>.</rs-line>';
    expect(issuesOf(html)).toEqual([expect.stringContaining('nicht in <rs-error> verschachtelt')]);
  });

  it('rejects an omission nested in an error', () => {
    const html =
      '<rs-line n="1"><rs-error type="Sb" fix="x y">x<rs-missing type="Z" fix=","></rs-missing></rs-error></rs-line>';
    expect(issuesOf(html)[0]).toContain('<rs-missing> darf nicht in <rs-error> verschachtelt sein');
  });

  it('rejects missing required attributes with their names', () => {
    expect(issuesOf('<rs-line n="1"><rs-error fix="b">a</rs-error></rs-line>')).toEqual([
      '<rs-error>: Pflichtattribut type fehlt.',
    ]);
    expect(issuesOf('<rs-line n="1"><rs-error type="R">a</rs-error></rs-line>')).toEqual([
      expect.stringContaining('Pflichtattribut fix fehlt'),
    ]);
    expect(issuesOf('<rs-line><rs-error type="R" fix="b">a</rs-error></rs-line>')).toEqual([
      '<rs-line>: Pflichtattribut n fehlt. (1. <rs-line> der Ausgabe)',
    ]);
  });

  it('rejects malformed line numbers and bounding boxes', () => {
    expect(issuesOf('<rs-line n="eins">a</rs-line>')[0]).toContain('positive ganze Zahl');
    expect(issuesOf('<rs-line n="1" bbox="1,2,3">a</rs-line>')[0]).toContain('vier Zahlen');
    expect(issuesOf('<rs-line n="1" bbox="1,2,0,5">a</rs-line>')[0]).toContain('Breite');
  });

  it('rejects a self-closing omission that swallows the following text', () => {
    const html = '<rs-line n="1">Ich glaube<rs-missing type="Z" fix=","/> dass es geht.</rs-line>';
    const [message] = issuesOf(html);
    expect(message).toContain('<rs-missing> darf keinen Inhalt haben');
  });

  it('rejects an omission without the missing text', () => {
    const html =
      '<rs-line n="1">Ich glaube<rs-missing type="Z" fix=""></rs-missing> dass</rs-line>';
    expect(issuesOf(html)).toEqual([
      '<rs-missing>: Das Attribut fix muss den fehlenden Text enthalten.',
    ]);
  });

  it('rejects an empty error element and points to rs-missing', () => {
    const html = '<rs-line n="1">a<rs-error type="Z" fix=",">  </rs-error>b</rs-line>';
    expect(issuesOf(html)[0]).toContain('<rs-missing>');
  });

  it('rejects a correction identical to the original', () => {
    const html = '<rs-line n="1"><rs-error type="R" fix="Hund">Hund</rs-error></rs-line>';
    expect(issuesOf(html)[0]).toContain('identisch mit dem Originaltext');
  });

  it('rejects text and elements outside of lines', () => {
    const html = 'Hier ist die Transkription:\n<rs-line n="1">a</rs-line>\n<p>Fertig</p>';
    expect(issuesOf(html)).toEqual([
      expect.stringContaining('Text außerhalb einer Zeile: „Hier ist die Transkription:“'),
      expect.stringContaining('<p> steht außerhalb einer <rs-line>'),
    ]);
  });

  it('rejects a marking outside of a line', () => {
    expect(issuesOf('<rs-error type="R" fix="b">a</rs-error>')[0]).toContain(
      'außerhalb einer <rs-line>',
    );
  });

  it('rejects unknown elements and nested lines inside a line', () => {
    expect(issuesOf('<rs-line n="1">a <b>fett</b></rs-line>')).toEqual([
      'Unbekanntes Element <b> in der Zeile.',
    ]);
    expect(issuesOf('<rs-line n="1">a<rs-line n="2">b</rs-line></rs-line>')[0]).toContain(
      'darf nicht in einer anderen <rs-line>',
    );
  });

  it('rejects duplicate and descending line numbers', () => {
    const result = parseTranscript('<rs-line n="2">a</rs-line><rs-line n="2">b</rs-line>');
    expect(result).toEqual({
      ok: false,
      issues: [{ line: 2, message: expect.stringContaining('müssen aufsteigen') }],
    });
  });

  it('rejects empty output', () => {
    expect(issuesOf('')).toEqual(['Die Ausgabe enthält keine <rs-line>-Zeile.']);
    expect(issuesOf('Ich kann leider keine Fehler finden.')).toEqual([
      expect.stringContaining('Text außerhalb einer Zeile'),
    ]);
  });

  it('reports all problems at once so one retry can fix them', () => {
    const html = [
      '<rs-line n="1"><rs-error type="Q" fix="b">a</rs-error></rs-line>',
      '<rs-line n="2"><rs-error type="R">a</rs-error></rs-line>',
      '<rs-line n="3">ok <b>x</b></rs-line>',
    ].join('\n');
    const result = parseTranscript(html, { profile: DEUTSCH });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map((issue) => issue.line)).toEqual([1, 2, 3]);
  });
});

describe('formatIssues', () => {
  it('writes one bullet per issue with the line number where known', () => {
    expect(formatIssues([{ line: 3, message: 'Kaputt.' }, { message: 'Auch kaputt.' }])).toBe(
      '- Zeile 3: Kaputt.\n- Auch kaputt.',
    );
  });
});
