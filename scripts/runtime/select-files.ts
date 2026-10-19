import type { ArchiveEntry } from './archive.ts';

export interface RuntimeFiles {
  server: Uint8Array;
  libraries: Map<string, Uint8Array>;
  notices: Map<string, Uint8Array>;
}

const SHARED_LIBRARY = /\.(dylib|dll|so(\.\d+)*)$/;
const SONAME = /^lib[^.]+(\.\d+\.dylib|\.so\.\d+)$/;
const TOOL_IMPLEMENTATION = /-impl\.(dylib|dll|so)$/;
const SERVER_IMPLEMENTATION = /^(lib)?llama-server-impl\./;
const THIRD_PARTY_NOTICE = /^LICENSE-.+/;

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function isWanted(name: string): boolean {
  if (!SHARED_LIBRARY.test(name)) return false;
  return !TOOL_IMPLEMENTATION.test(name) || SERVER_IMPLEMENTATION.test(name);
}

export function selectRuntimeFiles(
  entries: readonly ArchiveEntry[],
  exeSuffix: string,
): RuntimeFiles {
  const files = new Map<string, Uint8Array>();
  const links = new Map<string, string>();
  for (const entry of entries) {
    const name = baseName(entry.path);
    if (entry.kind === 'file') files.set(name, entry.data);
    else links.set(name, baseName(entry.target));
  }

  const resolve = (name: string): string => {
    const seen = new Set<string>();
    let current = name;
    while (links.has(current)) {
      if (seen.has(current)) throw new Error(`Symlink cycle at ${name}`);
      seen.add(current);
      current = links.get(current) ?? current;
    }
    return current;
  };

  const server = files.get(`llama-server${exeSuffix}`);
  if (!server) throw new Error(`Archive contains no llama-server${exeSuffix}`);

  const libraries = new Map<string, Uint8Array>();
  const replacedByLink = new Set<string>();
  for (const name of links.keys()) {
    if (!SONAME.test(name) || !isWanted(name)) continue;
    const real = resolve(name);
    const data = files.get(real);
    if (!data) throw new Error(`Symlink ${name} points to missing ${real}`);
    libraries.set(name, data);
    replacedByLink.add(real);
  }
  for (const [name, data] of files) {
    if (isWanted(name) && !replacedByLink.has(name)) libraries.set(name, data);
  }

  const notices = new Map<string, Uint8Array>();
  for (const [name, data] of files) {
    if (THIRD_PARTY_NOTICE.test(name)) notices.set(name, data);
  }

  return { server, libraries, notices };
}
