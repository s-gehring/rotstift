import process from 'node:process';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

const MODULE_MARKERS = ['Simulierter Fehler zum Testen', 'Vorschautext'];

async function bundleCode(nodeEnv: 'production' | 'development'): Promise<string> {
  const previous = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = nodeEnv;
  try {
    const result = await build({
      mode: nodeEnv,
      logLevel: 'silent',
      build: { write: false, minify: false },
    });
    const bundles = Array.isArray(result) ? result : [result];
    return bundles
      .flatMap((bundle) => ('output' in bundle ? bundle.output : []))
      .map((chunk) => (chunk.type === 'chunk' ? chunk.code : chunk.fileName))
      .join('\n');
  } finally {
    if (previous === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = previous;
  }
}

describe('preview transcriber in builds', () => {
  it('is absent from the production bundle', async () => {
    const code = await bundleCode('production');
    for (const marker of MODULE_MARKERS) expect(code).not.toContain(marker);
  }, 120_000);

  it('is present in a development bundle (guards the check above)', async () => {
    const code = await bundleCode('development');
    for (const marker of MODULE_MARKERS) expect(code).toContain(marker);
  }, 120_000);
});
