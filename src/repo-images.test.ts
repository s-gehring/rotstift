import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const IMAGE_FILE = /\.(png|jpe?g|webp|gif|tiff?|bmp|heic|heif|avif|pdf|svg)$/iu;
const ALLOWED_PREFIXES = ['src-tauri/icons/'];
const ALLOWED_FILES: readonly string[] = [];

function trackedFiles(): string[] {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: import.meta.dirname,
    encoding: 'utf8',
  }).trim();
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file !== '');
}

describe('tracked files', () => {
  it('contain no images or PDFs outside the app icons', () => {
    const offending = trackedFiles().filter(
      (file) =>
        IMAGE_FILE.test(file) &&
        !ALLOWED_FILES.includes(file) &&
        !ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix)),
    );
    expect(offending).toEqual([]);
  });

  it('recognizes an image outside the allowed folders', () => {
    expect(IMAGE_FILE.test('src/layout/fixtures/page.JPG')).toBe(true);
    expect(IMAGE_FILE.test('docs/scan.pdf')).toBe(true);
    expect(IMAGE_FILE.test('src/app/App.tsx')).toBe(false);
  });
});
