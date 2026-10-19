import { describe, expect, it } from 'vitest';
import type { ArchiveEntry } from './archive.ts';
import { selectRuntimeFiles } from './select-files.ts';

const file = (path: string, content = path): ArchiveEntry => ({
  kind: 'file',
  path,
  data: new TextEncoder().encode(content),
});
const link = (path: string, target: string): ArchiveEntry => ({ kind: 'symlink', path, target });

describe('selectRuntimeFiles', () => {
  it('keeps macOS libraries under their install name only', () => {
    const files = selectRuntimeFiles(
      [
        file('llama-b1/llama-server'),
        file('llama-b1/llama-cli'),
        file('llama-b1/libggml.0.26.0.dylib', 'ggml'),
        link('llama-b1/libggml.0.dylib', 'libggml.0.26.0.dylib'),
        link('llama-b1/libggml.dylib', 'libggml.0.dylib'),
        file('llama-b1/libllama-server-impl.dylib'),
        file('llama-b1/libllama-cli-impl.dylib'),
        file('llama-b1/LICENSE'),
      ],
      '',
    );
    expect([...files.libraries.keys()].toSorted()).toEqual([
      'libggml.0.dylib',
      'libllama-server-impl.dylib',
    ]);
    expect(new TextDecoder().decode(files.libraries.get('libggml.0.dylib'))).toBe('ggml');
  });

  it('keeps Linux sonames and dynamically loaded CPU backends', () => {
    const files = selectRuntimeFiles(
      [
        file('llama-b1/llama-server'),
        file('llama-b1/libllama.so.0.6.0'),
        link('llama-b1/libllama.so.0', 'libllama.so.0.6.0'),
        link('llama-b1/libllama.so', 'libllama.so.0'),
        file('llama-b1/libggml-cpu-haswell.so'),
        file('llama-b1/libggml-rpc.so'),
      ],
      '',
    );
    expect([...files.libraries.keys()].toSorted()).toEqual([
      'libggml-cpu-haswell.so',
      'libggml-rpc.so',
      'libllama.so.0',
    ]);
  });

  it('keeps Windows DLLs and third-party notices', () => {
    const files = selectRuntimeFiles(
      [
        file('llama-server.exe', 'server'),
        file('llama-server-impl.dll'),
        file('llama-bench-impl.dll'),
        file('ggml-cpu-x64.dll'),
        file('libomp.dll'),
        file('LICENSE-LLVM-OpenMP'),
      ],
      '.exe',
    );
    expect(new TextDecoder().decode(files.server)).toBe('server');
    expect([...files.libraries.keys()].toSorted()).toEqual([
      'ggml-cpu-x64.dll',
      'libomp.dll',
      'llama-server-impl.dll',
    ]);
    expect([...files.notices.keys()]).toEqual(['LICENSE-LLVM-OpenMP']);
  });

  it('fails when the archive has no server binary', () => {
    expect(() => selectRuntimeFiles([file('llama-cli')], '')).toThrow(/no llama-server/i);
  });

  it('fails on dangling symlinks', () => {
    expect(() =>
      selectRuntimeFiles([file('llama-server'), link('libggml.0.dylib', 'missing')], ''),
    ).toThrow(/missing/);
  });
});
