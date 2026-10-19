import { describe, expect, it } from 'vitest';
import { drawRotated, type DrawingContext } from './canvas.ts';

function recordingContext() {
  const calls: unknown[][] = [];
  const context: DrawingContext = {
    fillStyle: '',
    imageSmoothingQuality: 'low',
    fillRect: (...args) => void calls.push(['fillRect', ...args]),
    translate: (...args) => void calls.push(['translate', ...args]),
    rotate: (...args) => void calls.push(['rotate', ...args]),
    drawImage: (...args: unknown[]) => void calls.push(['drawImage', ...args]),
  };
  return { context, calls };
}

const image: CanvasImageSource = { width: 1, height: 1, close: () => undefined };

describe('drawRotated', () => {
  it('paints a white background before transforming', () => {
    const { context, calls } = recordingContext();
    drawRotated(context, image, { width: 200, height: 300 }, { width: 200, height: 300 }, 0);
    expect(context.fillStyle).toBe('#fff');
    expect(calls.map((call) => call[0])).toEqual(['fillRect', 'translate', 'rotate', 'drawImage']);
    expect(calls[0]).toEqual(['fillRect', 0, 0, 200, 300]);
  });

  it('rotates around the canvas center and draws the image centered', () => {
    const { context, calls } = recordingContext();
    drawRotated(context, image, { width: 300, height: 200 }, { width: 200, height: 300 }, 90);
    expect(calls[1]).toEqual(['translate', 150, 100]);
    expect(calls[2]).toEqual(['rotate', Math.PI / 2]);
    expect(calls[3]).toEqual(['drawImage', image, -100, -150, 200, 300]);
  });

  it('requests high quality smoothing', () => {
    const { context } = recordingContext();
    drawRotated(context, image, { width: 1, height: 1 }, { width: 1, height: 1 }, 0);
    expect(context.imageSmoothingQuality).toBe('high');
  });
});
