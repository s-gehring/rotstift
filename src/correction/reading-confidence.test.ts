import { describe, expect, it } from 'vitest';
import { charProbabilities, lineProbabilities, markConfidence } from './reading-confidence.ts';

const bytes = (text: string) => [...new TextEncoder().encode(text)];

describe('charProbabilities', () => {
  it('gives every character the probability of its token, multi-byte characters included', () => {
    const tokens = [
      { bytes: bytes('Gr'), logprob: Math.log(0.9) },
      { bytes: bytes('üß'), logprob: Math.log(0.4) },
      { bytes: bytes('e'), logprob: 0 },
    ];
    const result = charProbabilities('Grüße', tokens);
    expect(result?.map((value) => value.toFixed(2))).toEqual([
      '0.90',
      '0.90',
      '0.40',
      '0.40',
      '1.00',
    ]);
  });

  it('takes the lowest token when a character spans two tokens', () => {
    const [first = 0, second = 0] = bytes('ä');
    const tokens = [
      { bytes: [first], logprob: Math.log(0.8) },
      { bytes: [second], logprob: Math.log(0.3) },
    ];
    expect(charProbabilities('ä', tokens)?.[0]).toBeCloseTo(0.3);
  });

  it('refuses tokens that do not spell the content', () => {
    expect(charProbabilities('ab', [{ bytes: bytes('ac'), logprob: 0 }])).toBeNull();
  });
});

describe('lineProbabilities and markConfidence', () => {
  const content = '\nDie  Lusammenkunft\nwar gut';
  const probabilities = Array.from(content, (_, index) => (index === 6 ? 0.2 : 0.99));

  it('maps cleaned lines back onto the raw answer', () => {
    const lines = lineProbabilities(content, probabilities, ['Die Lusammenkunft', 'war gut']);
    expect(lines[0]?.[4]).toBe(0.2);
    expect(lines[1]).toEqual([0.99, 0.99, 0.99, 1, 0.99, 0.99, 0.99]);
  });

  it('scores a mark by the least certain character of the words it touches', () => {
    const [line = []] = lineProbabilities(content, probabilities, ['Die Lusammenkunft']);
    const error = {
      kind: 'error' as const,
      type: 'R',
      original: 'ammen',
      correction: 'x',
      offset: 6,
    };
    expect(markConfidence('Die Lusammenkunft', line, error)).toBe(0.2);
    const comma = {
      kind: 'omission' as const,
      type: 'Z',
      original: '',
      correction: ',',
      offset: 3,
    };
    expect(markConfidence('Die Lusammenkunft', line, comma)).toBe(0.99);
  });
});
