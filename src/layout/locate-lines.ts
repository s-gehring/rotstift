import { assignWithSources } from './assign.ts';
import { topAt } from './band.ts';
import { toWorkingGray } from './gray.ts';
import { joinPieces, splitLongLines } from './flow.ts';
import { binarize, estimateSkewTangent, removeRulesAndArtifacts } from './ink.ts';
import { placeRoughly } from './rough.ts';
import { segmentLines } from './segment.ts';
import type { LayoutResult, LineBox, RgbaImage } from './types.ts';

export function detectLineBoxes(image: RgbaImage): {
  boxes: LineBox[];
  inkCounts: number[];
  skewDegrees: number;
} {
  const gray = toWorkingGray(image);
  const mask = binarize(gray);
  const rough = estimateSkewTangent(mask);
  const bridges = removeRulesAndArtifacts(mask, rough);
  const tan = estimateSkewTangent(mask);
  const { lines } = segmentLines(mask, bridges, tan);
  const unscale = 1 / gray.scale;
  const clampX = (value: number) => Math.min(image.width, Math.max(0, value));
  const clampY = (value: number) => Math.min(image.height, Math.max(0, value));
  const boxes = lines.map((line): LineBox => {
    const x0 = clampX(Math.floor(line.x * unscale));
    const y0 = clampY(Math.floor(line.y * unscale));
    const x1 = clampX(Math.ceil((line.x + line.width) * unscale));
    const y1 = clampY(Math.ceil((line.y + line.height) * unscale));
    return {
      x: x0,
      y: y0,
      width: Math.max(1, x1 - x0),
      height: Math.max(1, y1 - y0),
      band: {
        top: line.band.top.map((point) => ({
          x: clampX(point.x * unscale),
          y: point.y * unscale,
        })),
        height: line.band.height * unscale,
      },
    };
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
  const candidates = detected.boxes.map((box, i) => {
    const middle = box.x + box.width / 2;
    const center =
      box.band === undefined
        ? box.y + box.height / 2
        : topAt(box.band, middle) + box.band.height / 2;
    return { ...box, inkCount: detected.inkCounts[i] ?? 0, row: center - middle * tan };
  });
  const flow = splitLongLines(transcript, candidates);
  const assignment = assignWithSources(candidates, flow.texts);
  const placed = placeRoughly(candidates, assignment, flow.texts);
  return {
    lines: flow.split
      ? joinPieces(flow, assignment, placed, candidates, transcript.length)
      : placed,
    skewDegrees: detected.skewDegrees,
    detectedLines: detected.boxes.length,
  };
}
