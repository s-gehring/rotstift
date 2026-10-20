import { readFileSync } from 'node:fs';
import process from 'node:process';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { configDefaults } from 'vitest/config';

const PDFJS_DECODERS = ['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js'];
const PDFJS_DECODERS_PATH = 'pdfjs-decoders';

function readDecoder(name: string): Buffer {
  return readFileSync(new URL(`./node_modules/pdfjs-dist/wasm/${name}`, import.meta.url));
}

function pdfjsDecoders(): Plugin {
  return {
    name: 'pdfjs-decoders',
    configureServer(server) {
      server.middlewares.use(`/${PDFJS_DECODERS_PATH}`, (request, response, next) => {
        const name = PDFJS_DECODERS.find((candidate) => request.url === `/${candidate}`);
        if (name === undefined) {
          next();
          return;
        }
        response.setHeader('content-type', 'text/javascript');
        response.end(readDecoder(name));
      });
    },
    generateBundle() {
      for (const name of PDFJS_DECODERS) {
        this.emitFile({
          type: 'asset',
          fileName: `${PDFJS_DECODERS_PATH}/${name}`,
          source: readDecoder(name),
        });
      }
    },
  };
}

const host = process.env['TAURI_DEV_HOST'];

export default defineConfig({
  plugins: [react(), pdfjsDecoders()],
  clearScreen: false,
  test: { exclude: [...configDefaults.exclude, '**/.claude/**'] },
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
});
