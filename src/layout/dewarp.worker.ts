import { applyDewarp, planDewarp } from './dewarp.ts';
import type { DewarpRequest, DewarpResponse } from './dewarp-protocol.ts';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<DewarpRequest>) => void): void;
  postMessage(message: DewarpResponse, transfer: Transferable[]): void;
}

function isWorkerScope(value: unknown): value is WorkerScope {
  return typeof value === 'object' && value !== null && 'postMessage' in value;
}

function answer(request: DewarpRequest): { response: DewarpResponse; transfer: Transferable[] } {
  const image = {
    width: request.image.width,
    height: request.image.height,
    data: new Uint8ClampedArray(request.image.buffer),
  };
  if (request.task === 'plan') {
    return { response: { id: request.id, ok: true, plan: planDewarp(image) }, transfer: [] };
  }
  const straight = applyDewarp(image, request.plan);
  const buffer = straight.data.buffer;
  return {
    response: {
      id: request.id,
      ok: true,
      image: { width: straight.width, height: straight.height, buffer },
    },
    transfer: [buffer],
  };
}

function serve(scope: WorkerScope): void {
  scope.addEventListener('message', (event) => {
    try {
      const { response, transfer } = answer(event.data);
      scope.postMessage(response, transfer);
    } catch (error) {
      scope.postMessage(
        {
          id: event.data.id,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        },
        [],
      );
    }
  });
}

if (isWorkerScope(self)) serve(self);
