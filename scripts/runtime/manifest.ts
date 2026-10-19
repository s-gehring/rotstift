export const LLAMA_CPP_VERSION = 'b11537';

export const LICENSE = {
  url: `https://raw.githubusercontent.com/ggml-org/llama.cpp/${LLAMA_CPP_VERSION}/LICENSE`,
  sha256: '94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d',
};

export interface RuntimeAsset {
  target: string;
  archive: string;
  sha256: string;
}

export const ASSETS: readonly RuntimeAsset[] = [
  {
    target: 'aarch64-apple-darwin',
    archive: `llama-${LLAMA_CPP_VERSION}-bin-macos-arm64.tar.gz`,
    sha256: '26a97a36c0471475795760635fce44d45232f43f4cbfff00c428388c4815aaa2',
  },
  {
    target: 'x86_64-apple-darwin',
    archive: `llama-${LLAMA_CPP_VERSION}-bin-macos-x64.tar.gz`,
    sha256: '2bf899f48336ac4893055faee6f12e60403a0ea27e225d268de4890d33ce2adc',
  },
  {
    target: 'x86_64-unknown-linux-gnu',
    archive: `llama-${LLAMA_CPP_VERSION}-bin-ubuntu-x64.tar.gz`,
    sha256: 'ee03a40fcf16d2ebf88c02f7eac6ae40fbaf332aec18c18651dcd441610a5451',
  },
  {
    target: 'x86_64-pc-windows-msvc',
    archive: `llama-${LLAMA_CPP_VERSION}-bin-win-cpu-x64.zip`,
    sha256: 'a05c2d35ebe9787489277d6e039b391fd006384a6c49d069395f3a7b47186fd2',
  },
];

export function assetUrl(asset: RuntimeAsset): string {
  return `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_VERSION}/${asset.archive}`;
}

const HOST_TARGETS: Record<string, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
};

export function hostTarget(platform: string, arch: string): string | undefined {
  return HOST_TARGETS[`${platform}-${arch}`];
}

export function findAsset(target: string): RuntimeAsset {
  const asset = ASSETS.find((candidate) => candidate.target === target);
  if (!asset) {
    const known = ASSETS.map((candidate) => candidate.target).join(', ');
    throw new Error(`No llama.cpp build pinned for ${target}. Supported: ${known}`);
  }
  return asset;
}
