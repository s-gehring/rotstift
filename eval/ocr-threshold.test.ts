import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanPages } from './ocr-threshold.ts';

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rotstift-scans-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

describe('scanPages', () => {
  it('counts the built-in errors of each page', () => {
    const dir = folder({
      'a.jpg': '',
      'a.txt': 'Ich habe {gefreud|gefreut|R} und{|,|Z} gelacht.',
      'b.png': '',
      'b.txt': 'Alles richtig geschrieben.',
      'notiz.md': '',
    });
    expect(scanPages(dir)).toEqual([
      { name: 'a', errors: 2 },
      { name: 'b', errors: 0 },
    ]);
  });

  it('refuses an image without its text', () => {
    expect(() => scanPages(folder({ 'a.jpg': '' }))).toThrow('a.txt');
  });

  it('refuses an empty folder', () => {
    expect(() => scanPages(folder({ 'a.txt': 'Text' }))).toThrow('Keine Bilder');
  });
});
