import { gunzipSync, inflateRawSync } from 'node:zlib';

export type ArchiveEntry =
  | { kind: 'file'; path: string; data: Uint8Array }
  | { kind: 'symlink'; path: string; target: string };

const BLOCK = 512;

function readString(bytes: Uint8Array, offset: number, length: number): string {
  const slice = bytes.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return new TextDecoder().decode(end === -1 ? slice : slice.subarray(0, end));
}

function readOctal(bytes: Uint8Array, offset: number, length: number): number {
  const text = readString(bytes, offset, length).trim();
  return text === '' ? 0 : Number.parseInt(text, 8);
}

function parsePax(data: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  const text = new TextDecoder().decode(data);
  let position = 0;
  while (position < text.length) {
    const space = text.indexOf(' ', position);
    const length = Number.parseInt(text.slice(position, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = text.slice(space + 1, position + length - 1);
    const equals = record.indexOf('=');
    records.set(record.slice(0, equals), record.slice(equals + 1));
    position += length;
  }
  return records;
}

export function readTar(tar: Uint8Array): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  let longName: string | undefined;
  let longLink: string | undefined;
  let pax = new Map<string, string>();

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;

    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] ?? 0);
    const data = tar.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'L') {
      longName = readString(data, 0, data.length);
      continue;
    }
    if (type === 'K') {
      longLink = readString(data, 0, data.length);
      continue;
    }
    if (type === 'x') {
      pax = parsePax(data);
      continue;
    }
    if (type === 'g') continue;

    const prefix = readString(header, 345, 155);
    const name = readString(header, 0, 100);
    const path = pax.get('path') ?? longName ?? (prefix ? `${prefix}/${name}` : name);
    const target = pax.get('linkpath') ?? longLink ?? readString(header, 157, 100);
    longName = undefined;
    longLink = undefined;
    pax = new Map();

    if (type === '0' || type === '\0') {
      entries.push({ kind: 'file', path, data: data.slice() });
    } else if (type === '2') {
      entries.push({ kind: 'symlink', path, target });
    }
  }
  return entries;
}

export function readTarGz(archive: Uint8Array): ArchiveEntry[] {
  return readTar(gunzipSync(archive));
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

export function readZip(archive: Uint8Array): ArchiveEntry[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let end = archive.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== END_OF_CENTRAL_DIRECTORY) end--;
  if (end < 0) throw new Error('Not a zip archive: end of central directory not found');

  const count = view.getUint16(end + 10, true);
  let position = view.getUint32(end + 16, true);
  const entries: ArchiveEntry[] = [];

  for (let index = 0; index < count; index++) {
    if (view.getUint32(position, true) !== CENTRAL_DIRECTORY_HEADER) {
      throw new Error('Corrupt zip archive: bad central directory header');
    }
    const method = view.getUint16(position + 10, true);
    const compressedSize = view.getUint32(position + 20, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const localOffset = view.getUint32(position + 42, true);
    const path = new TextDecoder().decode(
      archive.subarray(position + 46, position + 46 + nameLength),
    );
    position += 46 + nameLength + extraLength + commentLength;

    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('Zip64 archives are not supported');
    }
    if (path.endsWith('/')) continue;
    if (view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) {
      throw new Error(`Corrupt zip archive: bad local header for ${path}`);
    }
    const dataStart =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true);
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);

    let data: Uint8Array;
    if (method === 0) data = compressed.slice();
    else if (method === 8) data = new Uint8Array(inflateRawSync(compressed));
    else throw new Error(`Unsupported zip compression method ${method} for ${path}`);
    entries.push({ kind: 'file', path, data });
  }
  return entries;
}
