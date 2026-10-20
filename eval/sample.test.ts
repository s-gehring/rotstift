import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSample } from './sample.ts';

describe('parseSample', () => {
  it('separates the written text from the corrected text', () => {
    const sample = parseSample('Ich glaube{|,|Z} {das|dass|R} es regnet.');
    expect(sample.written).toBe('Ich glaube das es regnet.');
    expect(sample.corrected).toBe('Ich glaube, dass es regnet.');
    expect(sample.errors).toEqual([
      { written: '', correct: ',', kind: 'Z', start: 10, end: 10 },
      { written: 'das', correct: 'dass', kind: 'R', start: 11, end: 14 },
    ]);
  });

  it('rejects incomplete markup', () => {
    expect(() => parseSample('Ein {Fehler|Fehler} ohne Art.')).toThrow(/malformed/i);
  });

  it('parses every committed sample text', () => {
    const dir = join(import.meta.dirname, 'samples', 'texts');
    const files = readdirSync(dir).filter((name) => name.endsWith('.txt'));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const sample = parseSample(readFileSync(join(dir, file), 'utf8'));
      expect(sample.errors.length).toBeGreaterThanOrEqual(8);
      for (const error of sample.errors) {
        expect(sample.written.slice(error.start, error.end)).toBe(error.written);
      }
    }
  });
});
