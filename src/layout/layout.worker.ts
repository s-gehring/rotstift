import { decodeImage } from './decode.ts';
import { locateLines } from './locate-lines.ts';
import { findStruckWords } from './strike.ts';
import type { LayoutRequest, LayoutResponse } from './protocol.ts';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<LayoutRequest>) => void): void;
  postMessage(message: LayoutResponse, transfer: Transferable[]): void;
}

function isWorkerScope(value: unknown): value is WorkerScope {
  return typeof value === 'object' && value !== null && 'postMessage' in value;
}

function serve(scope: WorkerScope): void {
  scope.addEventListener('message', (event) => {
    const { id, image, lines, task } = event.data;
    const pixels =
      image.kind === 'blob'
        ? decodeImage(image.blob)
        : Promise.resolve({
            width: image.width,
            height: image.height,
            data: new Uint8ClampedArray(image.buffer),
          });
    pixels
      .then((decoded) => {
        if (task === 'struck') {
          scope.postMessage({ id, ok: true, struck: findStruckWords(decoded, lines) }, []);
        } else {
          scope.postMessage({ id, ok: true, result: locateLines(decoded, lines) }, []);
        }
      })
      .catch((error: unknown) => {
        scope.postMessage(
          { id, ok: false, message: error instanceof Error ? error.message : String(error) },
          [],
        );
      });
  });
}

if (isWorkerScope(self)) serve(self);
