import { deflateRawSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readTar, readTarGz, readZip } from './archive.ts';

const encoder = new TextEncoder();

function tarHeader(name: string, size: number, type: string, link = ''): Uint8Array {
  const header = new Uint8Array(512);
  header.set(encoder.encode(name), 0);
  header.set(encoder.encode(size.toString(8).padStart(11, '0')), 124);
  header.set(encoder.encode(type), 156);
  header.set(encoder.encode(link), 157);
  header.set(encoder.encode('ustar'), 257);
  return header;
}

function tarEntry(name: string, content: string, type = '0', link = ''): Uint8Array[] {
  const data = encoder.encode(content);
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  return [tarHeader(name, data.length, type, link), padded];
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function zip(files: Record<string, string>): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const compressed = new Uint8Array(deflateRawSync(encoder.encode(content)));
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, 8, true);
    localView.setUint32(18, compressed.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, 8, true);
    centralView.setUint32(20, compressed.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local, compressed);
    centrals.push(central);
    offset += local.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(10, centrals.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return concat([...locals, ...centrals, end]);
}

const decode = (data: Uint8Array) => new TextDecoder().decode(data);

describe('readTar', () => {
  it('reads files and symlinks and skips directories', () => {
    const tar = concat([
      tarHeader('llama/', 0, '5'),
      ...tarEntry('llama/libggml.0.26.0.dylib', 'binary'),
      ...tarEntry('llama/libggml.0.dylib', '', '2', 'libggml.0.26.0.dylib'),
      new Uint8Array(1024),
    ]);
    const entries = readTar(tar);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: 'file', path: 'llama/libggml.0.26.0.dylib' });
    expect(entries[0]?.kind === 'file' && decode(entries[0].data)).toBe('binary');
    expect(entries[1]).toEqual({
      kind: 'symlink',
      path: 'llama/libggml.0.dylib',
      target: 'libggml.0.26.0.dylib',
    });
  });

  it('applies pax path records to the following entry', () => {
    const longName = `llama/${'x'.repeat(120)}.so`;
    const record = ` path=${longName}\n`;
    const length = record.length + String(record.length + 3).length;
    const pax = `${length}${record}`;
    const tar = concat([
      ...tarEntry('PaxHeader', pax, 'x'),
      ...tarEntry('truncated', 'data'),
      new Uint8Array(1024),
    ]);
    expect(readTar(tar)[0]?.path).toBe(longName);
  });

  it('reads gzip-compressed archives', () => {
    const tar = concat([...tarEntry('LICENSE', 'MIT'), new Uint8Array(1024)]);
    const [entry] = readTarGz(new Uint8Array(gzipSync(tar)));
    expect(entry?.kind === 'file' && decode(entry.data)).toBe('MIT');
  });
});

describe('readZip', () => {
  it('inflates every file of the archive', () => {
    const entries = readZip(zip({ 'llama-server.exe': 'exe', 'ggml.dll': 'dll' }));
    expect(entries.map((entry) => entry.path)).toEqual(['llama-server.exe', 'ggml.dll']);
    expect(entries[1]?.kind === 'file' && decode(entries[1].data)).toBe('dll');
  });

  it('rejects data that is not a zip archive', () => {
    expect(() => readZip(new Uint8Array(64))).toThrow(/not a zip archive/i);
  });
});
