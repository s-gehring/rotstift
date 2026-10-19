import { describe, expect, it } from 'vitest';
import { serializeLine, serializeTranscript } from './serialize.ts';

describe('serializeLine', () => {
  it('writes plain text without marks', () => {
    expect(serializeLine({ number: 3, text: 'Es war einmal.', marks: [] })).toBe(
      '<rs-line n="3">Es war einmal.</rs-line>',
    );
  });

  it('writes the bounding box in page coordinates', () => {
    const html = serializeLine({
      number: 1,
      bbox: { x: 40, y: 62.5, width: 700, height: 34 },
      text: 'Hallo',
      marks: [],
    });
    expect(html).toBe('<rs-line n="1" bbox="40,62.5,700,34">Hallo</rs-line>');
  });

  it('writes errors and omissions in place', () => {
    const html = serializeLine({
      number: 2,
      text: 'Ich glaube dass wir im Schwimbad waren.',
      marks: [
        { kind: 'omission', type: 'Z', original: '', correction: ',', offset: 10 },
        { kind: 'error', type: 'R', original: 'Schwimbad', correction: 'Schwimmbad', offset: 23 },
      ],
    });
    expect(html).toBe(
      '<rs-line n="2">Ich glaube<rs-missing type="Z" fix=","></rs-missing> dass wir im ' +
        '<rs-error type="R" fix="Schwimmbad">Schwimbad</rs-error> waren.</rs-line>',
    );
  });

  it('escapes markup characters in text and attributes', () => {
    const html = serializeLine({
      number: 1,
      text: 'a < b & "c"',
      marks: [{ kind: 'error', type: 'R', original: '"c"', correction: 'x"y<z', offset: 8 }],
    });
    expect(html).toBe(
      '<rs-line n="1">a &lt; b &amp; <rs-error type="R" fix="x&quot;y&lt;z">"c"</rs-error></rs-line>',
    );
  });

  it('writes a mark at the very start and end of the line', () => {
    const html = serializeLine({
      number: 1,
      text: 'Hunt',
      marks: [
        { kind: 'error', type: 'R', original: 'Hunt', correction: 'Hund', offset: 0 },
        { kind: 'omission', type: 'Z', original: '', correction: '.', offset: 4 },
      ],
    });
    expect(html).toBe(
      '<rs-line n="1"><rs-error type="R" fix="Hund">Hunt</rs-error><rs-missing type="Z" fix="."></rs-missing></rs-line>',
    );
  });
});

describe('serializeTranscript', () => {
  it('writes one line element per transcript line', () => {
    const html = serializeTranscript({
      lines: [
        { number: 1, text: 'Eins', marks: [] },
        { number: 2, text: 'Zwei', marks: [] },
      ],
    });
    expect(html).toBe('<rs-line n="1">Eins</rs-line>\n<rs-line n="2">Zwei</rs-line>');
  });

  it('writes an empty transcript as an empty string', () => {
    expect(serializeTranscript({ lines: [] })).toBe('');
  });
});
