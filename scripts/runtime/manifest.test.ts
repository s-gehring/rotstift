import { describe, expect, it } from 'vitest';
import { ASSETS, assetUrl, findAsset, hostTarget } from './manifest.ts';

describe('runtime manifest', () => {
  it('pins a SHA256 for every supported target', () => {
    expect(ASSETS.map((asset) => asset.target).toSorted()).toEqual([
      'aarch64-apple-darwin',
      'x86_64-apple-darwin',
      'x86_64-pc-windows-msvc',
      'x86_64-unknown-linux-gnu',
    ]);
    for (const asset of ASSETS) expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('downloads only from the official llama.cpp releases', () => {
    for (const asset of ASSETS) {
      expect(assetUrl(asset)).toMatch(/^https:\/\/github\.com\/ggml-org\/llama\.cpp\/releases\//);
    }
  });

  it('maps Node platforms to Rust target triples', () => {
    expect(hostTarget('darwin', 'arm64')).toBe('aarch64-apple-darwin');
    expect(hostTarget('win32', 'x64')).toBe('x86_64-pc-windows-msvc');
    expect(hostTarget('linux', 'arm64')).toBeUndefined();
  });

  it('names the supported targets when one is missing', () => {
    expect(() => findAsset('riscv64gc-unknown-linux-gnu')).toThrow(/aarch64-apple-darwin/);
  });
});
