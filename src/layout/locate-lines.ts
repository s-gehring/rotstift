import { assignWithSources } from './assign.ts';
import { topAt } from './band.ts';
import { toWorkingGray } from './gray.ts';
import { joinPieces, splitLongLines } from './flow.ts';
import { binarize, estimateSkewTangent, inkShareOf, removeRulesAndArtifacts } from './ink.ts';
import { markImplausible } from './plausible.ts';
import { placeRoughly } from './rough.ts';
import { eraseBinding, eraseRuling, findRuling, insideRuling, scaleRuling } from './ruling.ts';
import { segmentLines } from './segment.ts';
import type { BBox, LayoutResult, LineBox, RgbaImage, Ruling } from './types.ts';

const LONGEST_BRIDGE = 8;

export function detectLineBoxes(image: RgbaImage): {
  boxes: LineBox[];
  inkCounts: number[];
  skewDegrees: number;
  ruling: Ruling;
  inkShare: (box: BBox) => number;
} {
  const gray = toWorkingGray(image);
  const ruling = findRuling(gray, image);
  const mask = binarize(gray);
  const rough = estimateSkewTangent(mask);
  const bridges = removeRulesAndArtifacts(mask, rough, {
    erase: (target) => {
      eraseRuling(target, gray, ruling);
      eraseBinding(target, ruling);
    },
    pageEdges: true,
    longestBridge: LONGEST_BRIDGE,
  });
  const tan = estimateSkewTangent(mask);
  const lines = segmentLines(mask, bridges, tan).lines.filter((line) => insideRuling(ruling, line));
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
    ruling: scaleRuling(ruling, unscale),
    inkShare: inkShareOf(mask, gray.scale),
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
  const lines = flow.split
    ? joinPieces(flow, assignment, placed, candidates, transcript.length)
    : placed;
  return {
    lines: markImplausible(lines, detected.ruling, detected.inkShare),
    skewDegrees: detected.skewDegrees,
    detectedLines: detected.boxes.length,
    ruling: detected.ruling,
  };
}
