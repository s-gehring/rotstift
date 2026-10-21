// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { MAX_ISSUES, formatIssues, parseTranscript } from './parse.ts';
import type { ParseResult } from './parse.ts';
import { DEUTSCH, ENGLISCH, profileSchema } from './profile.ts';
import { serializeTranscript } from './serialize.ts';
import { listErrors } from './transcript.ts';
import type { Transcript } from './transcript.ts';

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
    expect(expectOk(parseTranscript(html, { profile: DEUTSCH })).lines[0]?.text).toBe(
      'Tom & Anna lachen <laut>.',
    );
  });

  it('strips a markdown code fence around the output', () => {
    const html = '```html\n<rs-line n="1">Hallo Welt</rs-line>\n```';
    expect(expectOk(parseTranscript(html, { profile: DEUTSCH })).lines[0]?.text).toBe('Hallo Welt');
  });

  it('accepts an empty correction for a superfluous word', () => {
    const html = '<rs-line n="1">Das ist <rs-error type="W" fix="">ist</rs-error> gut.</rs-line>';
    const mark = expectOk(parseTranscript(html, { profile: DEUTSCH })).lines[0]?.marks[0];
    expect(mark?.correction).toBe('');
  });

  it('accepts lines without a bounding box and with gaps in the numbering', () => {
    const html = '<rs-line n="2">Eins</rs-line><rs-line n="5">Zwei</rs-line>';
    const transcript = expectOk(parseTranscript(html, { profile: DEUTSCH }));
    expect(transcript.lines.map((line) => line.number)).toEqual([2, 5]);
    expect(transcript.lines[0]?.bbox).toBeUndefined();
  });

  it('keeps an omission at the end of a line after trailing whitespace', () => {
    const html = '<rs-line n="1">Es regnet <rs-missing type="Z" fix="."></rs-missing> </rs-line>';
    const line = expectOk(parseTranscript(html, { profile: DEUTSCH })).lines[0];
    expect(line?.text).toBe('Es regnet');
    expect(line?.marks[0]?.offset).toBe(9);
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
    const result = parseTranscript('<rs-line n="2">a</rs-line><rs-line n="2">b</rs-line>', {
      profile: DEUTSCH,
    });
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

describe('parseTranscript with unbalanced markings', () => {
  it('rejects an error element that is not closed before the end of its line', () => {
    const html = '<rs-line n="1">Der <rs-error type="R" fix="Hund">Hunt bellt laut</rs-line>';
    expect(parseTranscript(html, { profile: DEUTSCH })).toEqual({
      ok: false,
      issues: [{ line: 1, message: expect.stringContaining('<rs-error> wurde nicht geschlossen') }],
    });
  });

  it('rejects a marking that spans two lines and reports the stray closing tag', () => {
    const html =
      '<rs-line n="1">Der <rs-error type="R" fix="Hund">Hun</rs-line><rs-line n="2">d</rs-error> bellt</rs-line>';
    const result = parseTranscript(html, { profile: DEUTSCH });
    expect(result).toEqual({
      ok: false,
      issues: [
        { line: 1, message: expect.stringContaining('nicht geschlossen, bevor </rs-line>') },
        { line: 2, message: '</rs-error> ohne öffnendes <rs-error> in dieser Zeile.' },
      ],
    });
  });

  it('rejects an error element that is open when the next line starts', () => {
    const html = '<rs-line n="1">a <rs-error type="R" fix="b">c<rs-line n="2">d</rs-line>';
    expect(issuesOf(html)[0]).toContain('bevor die nächste <rs-line> kommt');
  });

  it('rejects elements that are still open at the end of the output', () => {
    expect(issuesOf('<rs-line n="1">a <rs-error type="R" fix="b">c')).toEqual([
      expect.stringContaining('bevor die Ausgabe endet'),
      '<rs-line> wurde nicht mit </rs-line> geschlossen.',
    ]);
  });

  it('rejects a stray closing line tag', () => {
    expect(issuesOf('<rs-line n="1">a</rs-line></rs-line>')).toEqual([
      '</rs-line> ohne öffnendes <rs-line>.',
    ]);
  });

  it('is not confused by a greater-than sign inside an attribute value', () => {
    const html = '<rs-line n="1"><rs-error type="R" fix="a>b">x</rs-error></rs-line>';
    expect(
      expectOk(parseTranscript(html, { profile: DEUTSCH })).lines[0]?.marks[0]?.correction,
    ).toBe('a>b');
  });
});

describe('parseTranscript attribute checks', () => {
  it('normalizes whitespace in the correction before comparing it', () => {
    const html =
      '<rs-line n="1">Wir <rs-error type="R" fix="  gehen   heim ">gehen heim</rs-error></rs-line>';
    expect(issuesOf(html)[0]).toContain('identisch mit dem Originaltext');
    const fixed =
      '<rs-line n="1">Wir <rs-error type="R" fix="  gingen   heim ">gehen heim</rs-error></rs-line>';
    const mark = expectOk(parseTranscript(fixed, { profile: DEUTSCH })).lines[0]?.marks[0];
    expect(mark?.correction).toBe('gingen heim');
  });

  it('rejects unknown attributes such as correction instead of fix', () => {
    const html = '<rs-line n="1"><rs-error type="R" correction="Hund">Hunt</rs-error></rs-line>';
    expect(issuesOf(html)).toEqual([
      '<rs-error>: Unbekanntes Attribut „correction“. Erlaubt sind: type, fix.',
      expect.stringContaining('<rs-error>: Pflichtattribut fix fehlt'),
    ]);
  });

  it('rejects unknown attributes on lines and omissions', () => {
    const html =
      '<rs-line n="1" id="a">Ich glaube<rs-missing type="Z" fix="," pos="3"></rs-missing> dass</rs-line>';
    expect(issuesOf(html)).toEqual([
      '<rs-line>: Unbekanntes Attribut „id“. Erlaubt sind: n, bbox.',
      '<rs-missing>: Unbekanntes Attribut „pos“. Erlaubt sind: type, fix.',
    ]);
  });

  it('rejects a negative bounding box position', () => {
    expect(issuesOf('<rs-line n="1" bbox="-4,10,100,20">a</rs-line>')).toEqual([
      '<rs-line>: Die Position x der Bounding Box darf nicht negativ sein.',
    ]);
  });
});

describe('parseTranscript issue list', () => {
  it('clips model text in messages', () => {
    const long = 'x'.repeat(200);
    const [message] = issuesOf(
      `<rs-line n="1"><rs-error type="${long}" fix="b">a</rs-error></rs-line>`,
    );
    expect(message?.length).toBeLessThan(160);
    expect(message).toContain(`${'x'.repeat(60)}…`);
    expect(issuesOf(`${long}<rs-line n="1">a</rs-line>`)[0]).not.toContain('x'.repeat(61));
  });

  it('caps the number of issues and counts the rest', () => {
    const html = Array.from(
      { length: 30 },
      (_, index) => `<rs-line n="${index + 1}"><rs-error type="Q" fix="b">a</rs-error></rs-line>`,
    ).join('\n');
    const messages = issuesOf(html);
    expect(messages).toHaveLength(MAX_ISSUES + 1);
    expect(messages.at(-1)).toBe('… und 10 weitere Meldungen.');
  });
});

describe('parseTranscript against the transcribed source', () => {
  const source: Transcript = {
    lines: [
      {
        number: 1,
        bbox: { x: 40, y: 60, width: 700, height: 30 },
        text: 'Der Hunt bellt.',
        marks: [],
      },
      { number: 2, text: 'Es regnet', marks: [] },
    ],
  };

  it('takes the bounding box from the source and drops one the source does not have', () => {
    const html =
      '<rs-line n="1" bbox="1,2,3,4">Der <rs-error type="R" fix="Hund">Hunt</rs-error> bellt.</rs-line><rs-line n="2" bbox="5,6,7,8">Es regnet</rs-line>';
    const transcript = expectOk(parseTranscript(html, { profile: DEUTSCH, source }));
    expect(transcript.lines[0]?.bbox).toEqual({ x: 40, y: 60, width: 700, height: 30 });
    expect(transcript.lines[1]?.bbox).toBeUndefined();
  });

  it('accepts a different whitespace layout of the same text', () => {
    const html = '<rs-line n="1">Der   Hunt\n bellt.</rs-line><rs-line n="2">Es regnet</rs-line>';
    expect(parseTranscript(html, { profile: DEUTSCH, source }).ok).toBe(true);
  });

  it('rejects text that the model changed and shows where', () => {
    const html = '<rs-line n="1">Der Hund bellt.</rs-line><rs-line n="2">Es regnet</rs-line>';
    expect(parseTranscript(html, { profile: DEUTSCH, source })).toEqual({
      ok: false,
      issues: [
        {
          line: 1,
          message: expect.stringMatching(
            /Erwartet: „Der Hunt bellt\.“, gefunden: „Der Hund bellt\.“/,
          ),
        },
      ],
    });
  });

  it('rejects missing and additional lines', () => {
    const html = '<rs-line n="1">Der Hunt bellt.</rs-line><rs-line n="3">Neu</rs-line>';
    const result = parseTranscript(html, { profile: DEUTSCH, source });
    expect(result).toEqual({
      ok: false,
      issues: [
        { line: 2, message: expect.stringContaining('fehlt in der Ausgabe') },
        { line: 3, message: expect.stringContaining('gibt es in der Eingabe nicht') },
      ],
    });
  });
});

describe('round trip parse, serialize, parse', () => {
  const cases: Record<string, string> = {
    entities:
      '<rs-line n="1">a &lt; b &amp; <rs-error type="R" fix="x&quot;y">c&amp;d</rs-error></rs-line>',
    'mark at line start and end':
      '<rs-line n="1"><rs-error type="R" fix="Hund">Hunt</rs-error> bellt <rs-error type="R" fix="laut">lat</rs-error></rs-line>',
    'adjacent errors':
      '<rs-line n="1"><rs-error type="R" fix="AB">ab</rs-error><rs-error type="G" fix="CD">cd</rs-error> ef</rs-line>',
    'empty correction':
      '<rs-line n="1">Das ist <rs-error type="W" fix="">ist</rs-error> gut.</rs-line>',
    'omission at start and end':
      '<rs-line n="1"><rs-missing type="Z" fix="„"></rs-missing>Hallo<rs-missing type="Z" fix="“"></rs-missing></rs-line>',
    'two omissions at one position':
      '<rs-line n="1">Ja<rs-missing type="Z" fix=","></rs-missing><rs-missing type="Z" fix="!"></rs-missing></rs-line>',
    'omission next to an error':
      '<rs-line n="1">Wir<rs-missing type="Z" fix=","></rs-missing><rs-error type="R" fix="dass">das</rs-error> es geht</rs-line>',
    'decimal bounding box and gaps in numbering':
      '<rs-line n="2" bbox="10.5,20,300.25,40">Eins</rs-line><rs-line n="7">Zwei</rs-line>',
    'empty line': '<rs-line n="1"></rs-line>',
  };

  it.each(Object.entries(cases))('is stable for %s', (_name, html) => {
    const first = expectOk(parseTranscript(html, { profile: DEUTSCH }));
    const serialized = serializeTranscript(first);
    const second = expectOk(parseTranscript(serialized, { profile: DEUTSCH }));
    expect(second).toEqual(first);
    expect(serializeTranscript(second)).toBe(serialized);
  });
});

describe('parseTranscript with struck text', () => {
  const html =
    '<rs-line n="1">Ich <rs-struck>gehe</rs-struck> ging<rs-missing type="Z" fix=","></rs-missing> als es <rs-error type="R" fix="dunkel">dunkl</rs-error> war.</rs-line>';

  it('keeps the struck text in the line and records its position', () => {
    const transcript = expectOk(parseTranscript(html, { profile: DEUTSCH }));
    expect(transcript.lines[0]).toMatchObject({
      text: 'Ich gehe ging als es dunkl war.',
      struck: [{ offset: 4, text: 'gehe' }],
    });
    expect(listErrors(transcript).map((error) => error.offset)).toEqual([13, 21]);
  });

  it('round-trips through the serializer', () => {
    const transcript = expectOk(parseTranscript(html, { profile: DEUTSCH }));
    expect(serializeTranscript(transcript)).toBe(html);
  });

  it('rejects markings inside struck text and empty struck elements', () => {
    expect(
      issuesOf(
        '<rs-line n="1"><rs-struck><rs-error type="R" fix="a">b</rs-error></rs-struck></rs-line>',
      ),
    ).toContain(
      '<rs-error> darf nicht in <rs-struck> verschachtelt sein. Markierungen dürfen sich nicht überlappen oder enthalten.',
    );
    expect(issuesOf('<rs-line n="1">a <rs-struck> </rs-struck></rs-line>')).toContain(
      'Ein <rs-struck> ohne Text ist leer.',
    );
  });
});
