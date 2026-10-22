export const LLAMA_CPP_VERSION = 'b11551';

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
    sha256: 'a588d3af8486ea4c074c91e5672052d6f65f02c8ca7774407f120470875c8987',
  },
  {
    target: 'x86_64-apple-darwin',
    archive: `llama-${LLAMA_CPP_VERSION}-bin-macos-x64.tar.gz`,
    sha256: '011a887aecf0a0616aa9a5f4bb1ebd707056ac83a2b77692b039be1da1db319a',
  },
  {
    target: 'x86_64-unknown-linux-gnu',
    archive: `llama-${LLAMA_CPP_VERSION}-bin-ubuntu-x64.tar.gz`,
    sha256: '603c5a751fd05376be6fa09a53c2875833558dd9bd9c06a9c0878518092eee27',
  },
  {
    target: 'x86_64-pc-windows-msvc',
    archive: `llama-${LLAMA_CPP_VERSION}-bin-win-cpu-x64.zip`,
    sha256: '5651a4530e1b55d84773137c485659a1384c3a65ea628fa39f55910b463fd892',
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
