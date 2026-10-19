import { describe, expect, it } from 'vitest';
import { detectFileKind, fileKey } from './file-kind.ts';

describe('detectFileKind', () => {
  it.each([
    ['scan.png', 'image/png', 'image'],
    ['foto.JPG', 'image/jpeg', 'image'],
    ['foto.jpeg', '', 'image'],
    ['bild.webp', 'image/webp', 'image'],
    ['arbeit.pdf', 'application/pdf', 'pdf'],
    ['ARBEIT.PDF', '', 'pdf'],
  ] as const)('detects %s (%s) as %s', (name, type, expected) => {
    expect(detectFileKind({ name, type })).toBe(expected);
  });

  it.each([
    ['notizen.txt', 'text/plain'],
    ['animation.gif', 'image/gif'],
    ['dokument.docx', ''],
    ['png', ''],
  ])('rejects %s (%s)', (name, type) => {
    expect(detectFileKind({ name, type })).toBeUndefined();
  });

  it('prefers the MIME type over a misleading extension', () => {
    expect(detectFileKind({ name: 'scan.dat', type: 'image/png' })).toBe('image');
  });
});

describe('fileKey', () => {
  it('is equal for the same name, size and modification time', () => {
    const file = { name: 'a.pdf', size: 10, lastModified: 5 };
    expect(fileKey(file)).toBe(fileKey({ ...file }));
  });

  it('differs when any part differs', () => {
    const file = { name: 'a.pdf', size: 10, lastModified: 5 };
    expect(fileKey(file)).not.toBe(fileKey({ ...file, size: 11 }));
    expect(fileKey(file)).not.toBe(fileKey({ ...file, lastModified: 6 }));
    expect(fileKey(file)).not.toBe(fileKey({ ...file, name: 'b.pdf' }));
  });
});
