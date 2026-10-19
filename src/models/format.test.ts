import { describe, expect, it } from 'vitest';
import {
  describeDownloadError,
  describeImport,
  formatMegabytes,
  formatMemory,
  formatSize,
  pushSample,
  remainingText,
} from './format.ts';
import type { DownloadError } from './types.ts';

describe('byte formatting', () => {
  it('uses German number formats', () => {
    expect(formatMegabytes(412_300_000)).toBe('412 MB');
    expect(formatMegabytes(1_552_463_168)).toBe('1.552 MB');
    expect(formatSize(1_552_463_168)).toBe('1,6 GB');
    expect(formatSize(445_000_000)).toBe('445 MB');
    expect(formatMemory(8 * 1024 ** 3)).toBe('8,0 GB');
  });
});

describe('remaining time', () => {
  it('needs a few seconds of samples before it estimates', () => {
    expect(remainingText([], 0, 100)).toBeNull();
    expect(remainingText([{ at: 0, bytes: 0 }], 0, 100)).toBeNull();
    expect(
      remainingText(
        [
          { at: 0, bytes: 0 },
          { at: 500, bytes: 10 },
        ],
        10,
        100,
      ),
    ).toBeNull();
  });

  it('extrapolates the speed of the recent window', () => {
    const mb = 1_000_000;
    let samples = pushSample([], { at: 0, bytes: 0 });
    samples = pushSample(samples, { at: 10_000, bytes: 10 * mb });
    expect(remainingText(samples, 10 * mb, 70 * mb)).toBe('etwa 1 Minute');
  });

  it('forgets old samples and resets after a restart of the download', () => {
    let samples = pushSample([], { at: 0, bytes: 100 });
    samples = pushSample(samples, { at: 20_000, bytes: 200 });
    expect(samples).toEqual([{ at: 20_000, bytes: 200 }]);
    samples = pushSample(samples, { at: 21_000, bytes: 50 });
    expect(samples).toEqual([{ at: 21_000, bytes: 50 }]);
  });
});

describe('describeDownloadError', () => {
  it('explains every error in German without technical details', () => {
    const errors: DownloadError[] = [
      { kind: 'insufficientDisk', detail: { needed: 2_000_000_000, available: 500_000_000 } },
      { kind: 'network', detail: 'error sending request' },
      { kind: 'incomplete' },
      { kind: 'http', detail: { status: 503 } },
      { kind: 'hashMismatch', detail: { file: 'a.gguf' } },
      { kind: 'sizeMismatch', detail: { file: 'a.gguf' } },
      { kind: 'notAllowed', detail: 'redirect' },
      { kind: 'busy' },
      { kind: 'cancelled' },
      { kind: 'unknownModel', detail: 'x' },
      { kind: 'io', detail: 'No space left on device' },
    ];
    for (const error of errors) {
      const text = describeDownloadError(error);
      expect(text).toMatch(/^[A-ZÄÖÜ]/u);
      expect(text.endsWith('.')).toBe(true);
      expect(text).not.toContain('error sending request');
      expect(text).not.toContain('No space left');
    }
    expect(
      describeDownloadError({
        kind: 'insufficientDisk',
        detail: { needed: 2_000_000_000, available: 500_000_000 },
      }),
    ).toContain('Benötigt werden 2,0 GB, frei sind 500 MB');
  });
});

describe('describeImport', () => {
  it('says what happened with the chosen files', () => {
    const unknown = { name: 'x.gguf', reason: 'unknownFile' } as const;
    expect(describeImport([], [unknown], 2)).toContain('Keine der gewählten Dateien');
    expect(describeImport(['a.gguf'], [], 2)).toBe('Übernommen: 1 von 2 Dateien.');
    expect(describeImport(['a.gguf', 'b.gguf'], [], 2)).toBe('');
    expect(describeImport(['a.gguf', 'b.gguf'], [unknown], 2)).toContain('x.gguf');
  });

  it('names the reason for every file that was not imported', () => {
    const text = describeImport(
      ['a.gguf'],
      [
        { name: 'one.gguf', reason: 'wrongContent' },
        { name: 'two.gguf', reason: 'ioError' },
        { name: 'three.gguf', reason: 'duplicate' },
      ],
      2,
    );
    expect(text).toContain('one.gguf (Inhalt stimmt nicht');
    expect(text).toContain('two.gguf (konnte nicht gelesen oder gespeichert werden)');
    expect(text).toContain('three.gguf (wurde schon übernommen)');
    expect(text).toContain('Übernommen: 1 von 2 Dateien.');
  });
});
