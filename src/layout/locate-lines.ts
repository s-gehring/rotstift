import { assignLines } from './assign.ts';
import { toWorkingGray } from './gray.ts';
import { binarize, estimateSkewTangent, removeRulesAndArtifacts } from './ink.ts';
import { segmentLines } from './segment.ts';
import type { BBox, LayoutResult, RgbaImage } from './types.ts';

export function detectLineBoxes(image: RgbaImage): {
  boxes: BBox[];
  inkCounts: number[];
  skewDegrees: number;
} {
  const gray = toWorkingGray(image);
  const mask = binarize(gray);
  const tan = estimateSkewTangent(mask);
  const bridges = removeRulesAndArtifacts(mask, tan);
  const { lines } = segmentLines(mask, bridges, tan);
  const unscale = 1 / gray.scale;
  const clampX = (value: number) => Math.min(image.width, Math.max(0, value));
  const clampY = (value: number) => Math.min(image.height, Math.max(0, value));
  const boxes = lines.map((line) => {
    const x0 = clampX(Math.floor(line.x * unscale));
    const y0 = clampY(Math.floor(line.y * unscale));
    const x1 = clampX(Math.ceil((line.x + line.width) * unscale));
    const y1 = clampY(Math.ceil((line.y + line.height) * unscale));
    return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
  });
  return {
    boxes,
    inkCounts: lines.map((line) => line.inkCount),
    skewDegrees: (Math.atan(tan) * 180) / Math.PI,
  };
}

export function locateLines(image: RgbaImage, transcript: readonly string[]): LayoutResult {
  const detected = detectLineBoxes(image);
  const tan = Math.tan((detected.skewDegrees * Math.PI) / 180);
  const candidates = detected.boxes.map((box, i) => ({
    ...box,
    inkCount: detected.inkCounts[i] ?? 0,
    row: box.y + box.height / 2 - (box.x + box.width / 2) * tan,
  }));
  return {
    lines: assignLines(candidates, transcript),
    skewDegrees: detected.skewDegrees,
    detectedLines: detected.boxes.length,
  };
}
