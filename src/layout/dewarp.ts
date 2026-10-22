import { toWorkingGray } from './gray.ts';
import {
  homographyFrom,
  project,
  rectangleAspect,
  rotationAbout,
  type Homography,
} from './homography.ts';
import { findRuling } from './ruling.ts';
import { findSheet, type Sheet } from './sheet.ts';
import { fitSlopes, slopesFromLines, weightedMedianSlope, type SlopeModel } from './slope-field.ts';
import type { BBox, GrayImage, Point, RgbaImage } from './types.ts';

export interface DewarpPlan {
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
  readonly mesh: readonly number[];
}

export type RuleFinder = (gray: GrayImage) => readonly { readonly points: readonly Point[] }[];

export interface DewarpOptions {
  readonly rules?: RuleFinder;
}

export interface DewarpReport {
  readonly plan: DewarpPlan | null;
  readonly sheet: readonly Point[] | null;
  readonly skewDegrees: number;
  readonly rotationDegrees: number;
  readonly bend: number;
  readonly keystoneDegrees: number;
  readonly rules: number;
}

interface Plane {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

interface Frame {
  readonly width: number;
  readonly height: number;
  readonly toGray: (point: Point) => Point;
}

const WORKING_SIDE = 1000;
const MESH_COLUMNS = 33;
const MESH_ROWS = 45;
const TRACE_STEPS = 4;
const MAX_SLOPE = 0.3;
const MIN_ROTATION_DEGREES = 0.1;
const MIN_SHEET_SKEW_DEGREES = 0.75;
const MIN_BEND = 0.003;
const MIN_KEYSTONE_DEGREES = 1;
const MIN_OUTPUT_SHARE = 0.3;
const MIN_FOCAL = 0.4;
const MAX_FOCAL = 4;
const MAX_ASPECT_CHANGE = 1.25;

function halve(gray: Plane): Plane {
  const width = Math.max(1, Math.floor(gray.width / 2));
  const height = Math.max(1, Math.floor(gray.height / 2));
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = 2 * y * gray.width + 2 * x;
      data[y * width + x] =
        ((gray.data[at] ?? 0) +
          (gray.data[at + 1] ?? 0) +
          (gray.data[at + gray.width] ?? 0) +
          (gray.data[at + gray.width + 1] ?? 0) +
          2) >>
        2;
    }
  }
  return { width, height, data };
}

function sampleGray(plane: Plane, x: number, y: number): number {
  const fx = Math.max(0, Math.min(plane.width - 1, x - 0.5));
  const fy = Math.max(0, Math.min(plane.height - 1, y - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(plane.width - 1, x0 + 1);
  const y1 = Math.min(plane.height - 1, y0 + 1);
  const ax = fx - x0;
  const ay = fy - y0;
  const at = (px: number, py: number) => plane.data[py * plane.width + px] ?? 0;
  return (
    (at(x0, y0) * (1 - ax) + at(x1, y0) * ax) * (1 - ay) +
    (at(x0, y1) * (1 - ax) + at(x1, y1) * ax) * ay
  );
}

function warpPlane(gray: Plane, frame: Frame): Plane {
  const data = new Uint8Array(frame.width * frame.height);
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const point = frame.toGray({ x: x + 0.5, y: y + 0.5 });
      data[y * frame.width + x] = Math.round(sampleGray(gray, point.x, point.y));
    }
  }
  return { width: frame.width, height: frame.height, data };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sheetSize(corners: readonly [Point, Point, Point, Point], gray: Plane) {
  const [tl, tr, br, bl] = corners;
  const width = (distance(tl, tr) + distance(bl, br)) / 2;
  const height = (distance(tl, bl) + distance(tr, br)) / 2;
  const side = Math.max(gray.width, gray.height);
  const camera = rectangleAspect(corners, { x: gray.width / 2, y: gray.height / 2 });
  const plausible =
    camera !== null &&
    camera.focal >= MIN_FOCAL * side &&
    camera.focal <= MAX_FOCAL * side &&
    Math.abs(Math.log(camera.aspect / (width / height))) <= Math.log(MAX_ASPECT_CHANGE);
  if (!plausible) return { width: Math.round(width), height: Math.round(height) };
  const area = width * height;
  return {
    width: Math.round(Math.sqrt(area * camera.aspect)),
    height: Math.round(Math.sqrt(area / camera.aspect)),
  };
}

function sheetFrame(sheet: Sheet, factor: number, gray: Plane): Frame | null {
  const [tl, tr, br, bl] = sheet.corners.map((corner) => ({
    x: corner.x * factor,
    y: corner.y * factor,
  }));
  if (tl === undefined || tr === undefined || br === undefined || bl === undefined) return null;
  const corners: [Point, Point, Point, Point] = [tl, tr, br, bl];
  const { width, height } = sheetSize(corners, gray);
  const homography = homographyFrom(
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    corners,
  );
  if (homography === null || width < 16 || height < 16) return null;
  const h: Homography = homography;
  return { width, height, toGray: (point) => project(h, point) };
}

function edgeDegrees(a: Point, b: Point, vertical: boolean): number {
  const along = vertical ? b.y - a.y : b.x - a.x;
  const across = vertical ? b.x - a.x : b.y - a.y;
  return (Math.atan2(across, along) * 180) / Math.PI;
}

function sheetSkewDegrees(sheet: Sheet): number {
  const [tl, tr, br, bl] = sheet.corners;
  return Math.max(
    Math.abs(edgeDegrees(tl, tr, false)),
    Math.abs(edgeDegrees(bl, br, false)),
    Math.abs(edgeDegrees(tl, bl, true)),
    Math.abs(edgeDegrees(tr, br, true)),
  );
}

function rotatedFrame(gray: Plane, radians: number): Frame {
  const h = rotationAbout({ x: gray.width / 2, y: gray.height / 2 }, radians);
  return { width: gray.width, height: gray.height, toGray: (point) => project(h, point) };
}

function traceRow(model: SlopeModel | null, width: number, start: number): number[] {
  const columns = Array.from({ length: MESH_COLUMNS }, () => start);
  if (model === null) return columns;
  const spacing = width / (MESH_COLUMNS - 1);
  const center = (MESH_COLUMNS - 1) / 2;
  const slope = (x: number, y: number) =>
    Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, model.slopeAt(x, y)));
  for (const direction of [1, -1]) {
    let x = width / 2;
    let y = start;
    const step = (direction * spacing) / TRACE_STEPS;
    for (
      let column = center + direction;
      column >= 0 && column < MESH_COLUMNS;
      column += direction
    ) {
      for (let k = 0; k < TRACE_STEPS; k += 1) {
        const half = y + (step / 2) * slope(x, y);
        y += step * slope(x + step / 2, half);
        x += step;
      }
      columns[column] = y;
    }
  }
  return columns;
}

function lineFits(rows: readonly number[][], width: number, model: SlopeModel) {
  const spacing = width / (MESH_COLUMNS - 1);
  const xs = Array.from({ length: MESH_COLUMNS }, (_, i) => i * spacing);
  const meanX = width / 2;
  const sxx = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
  return rows.flatMap((ys) => {
    const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
    if (meanY < model.top || meanY > model.bottom) return [];
    const slope = xs.reduce((sum, x, i) => sum + (x - meanX) * ((ys[i] ?? 0) - meanY), 0) / sxx;
    const residual = Math.max(
      ...xs.map((x, i) => Math.abs((ys[i] ?? 0) - meanY - slope * (x - meanX))),
    );
    return [{ slope, residual }];
  });
}

function monotonic(mesh: readonly number[]): boolean {
  for (let j = 0; j < MESH_ROWS; j += 1) {
    for (let i = 0; i < MESH_COLUMNS; i += 1) {
      const at = 2 * (j * MESH_COLUMNS + i);
      if (i > 0 && (mesh[at] ?? 0) <= (mesh[at - 2] ?? 0)) return false;
      if (j > 0 && (mesh[at + 1] ?? 0) <= (mesh[at + 1 - 2 * MESH_COLUMNS] ?? 0)) return false;
    }
  }
  return true;
}

function plainGray(plane: Plane): GrayImage {
  return { ...plane, scale: 1 };
}

interface Distortion {
  readonly traced: number[][];
  readonly bend: number;
  readonly keystoneDegrees: number;
}

function measureDistortion(
  lines: readonly { readonly points: readonly Point[] }[],
  frame: Frame,
  plane: Plane,
): Distortion {
  const model = fitSlopes(slopesFromLines(lines), plane.width, plane.height);
  const traced = Array.from({ length: MESH_ROWS }, (_, j) =>
    traceRow(model, frame.width, (j * frame.height) / (MESH_ROWS - 1)),
  );
  const fits = model === null ? [] : lineFits(traced, frame.width, model);
  const bend = Math.max(0, ...fits.map((fit) => fit.residual)) / frame.height;
  const angles = fits.map((fit) => (Math.atan(fit.slope) * 180) / Math.PI);
  const keystoneDegrees = angles.length === 0 ? 0 : Math.max(...angles) - Math.min(...angles);
  return { traced, bend, keystoneDegrees };
}

function distorted({ bend, keystoneDegrees }: Distortion): boolean {
  return bend >= MIN_BEND || keystoneDegrees >= MIN_KEYSTONE_DEGREES;
}

export function analyzeDewarp(image: RgbaImage, options: DewarpOptions = {}): DewarpReport {
  const gray: GrayImage = toWorkingGray(image, WORKING_SIDE);
  const small = halve(gray);
  const sheet = findSheet(small);
  const factor = gray.width / small.width;
  const fromSheet = sheet === null ? null : sheetFrame(sheet, factor, gray);
  let frame: Frame = fromSheet ?? {
    width: gray.width,
    height: gray.height,
    toGray: (point) => point,
  };
  let plane = fromSheet === null ? gray : warpPlane(gray, frame);
  const findRules = options.rules ?? ((plain: GrayImage) => findRuling(plain).horizontal);
  let lines = findRules(plainGray(plane));
  let distortion = measureDistortion(lines, frame, plane);
  let rotationDegrees = 0;
  if (fromSheet === null && lines.length > 0) {
    const radians = Math.atan(weightedMedianSlope(slopesFromLines(lines)));
    rotationDegrees = (radians * 180) / Math.PI;
    if (Math.abs(rotationDegrees) >= MIN_ROTATION_DEGREES && distorted(distortion)) {
      frame = rotatedFrame(gray, radians);
      plane = warpPlane(gray, frame);
      lines = findRules(plainGray(plane));
      distortion = measureDistortion(lines, frame, plane);
    }
  }
  const { traced, bend, keystoneDegrees } = distortion;
  const corners =
    fromSheet === null || sheet === null
      ? null
      : sheet.corners.map((corner) => ({
          x: (corner.x * factor) / gray.scale,
          y: (corner.y * factor) / gray.scale,
        }));
  const skewDegrees = sheet === null || fromSheet === null ? 0 : sheetSkewDegrees(sheet);
  const report = {
    sheet: corners,
    skewDegrees,
    rotationDegrees,
    bend,
    keystoneDegrees,
    rules: lines.length,
  };
  const needed =
    (fromSheet !== null && skewDegrees >= MIN_SHEET_SKEW_DEGREES) || distorted(distortion);
  if (!needed) return { ...report, plan: null };
  const spacing = frame.width / (MESH_COLUMNS - 1);
  const mesh: number[] = [];
  traced.forEach((ys) => {
    ys.forEach((y, i) => {
      const point = frame.toGray({ x: i * spacing, y });
      mesh.push(point.x / gray.scale / image.width, point.y / gray.scale / image.height);
    });
  });
  const width = frame.width / gray.scale / image.width;
  const height = frame.height / gray.scale / image.height;
  const valid =
    monotonic(mesh) && width * height >= MIN_OUTPUT_SHARE && mesh.every(Number.isFinite);
  return {
    ...report,
    plan: valid ? { width, height, columns: MESH_COLUMNS, rows: MESH_ROWS, mesh } : null,
  };
}

export function planDewarp(image: RgbaImage, options: DewarpOptions = {}): DewarpPlan | null {
  return analyzeDewarp(image, options).plan;
}

export function outputSize(plan: DewarpPlan, source: { width: number; height: number }) {
  return {
    width: Math.max(1, Math.round(plan.width * source.width)),
    height: Math.max(1, Math.round(plan.height * source.height)),
  };
}

function meshPoint(plan: DewarpPlan, column: number, row: number): Point {
  const at = 2 * (row * plan.columns + column);
  return { x: plan.mesh[at] ?? 0, y: plan.mesh[at + 1] ?? 0 };
}

export function toSource(
  plan: DewarpPlan,
  point: Point,
  source: { width: number; height: number },
): Point {
  const size = outputSize(plan, source);
  const mx = Math.max(0, Math.min(plan.columns - 1, (point.x / size.width) * (plan.columns - 1)));
  const my = Math.max(0, Math.min(plan.rows - 1, (point.y / size.height) * (plan.rows - 1)));
  const i = Math.min(plan.columns - 2, Math.floor(mx));
  const j = Math.min(plan.rows - 2, Math.floor(my));
  const fx = mx - i;
  const fy = my - j;
  const a = meshPoint(plan, i, j);
  const b = meshPoint(plan, i + 1, j);
  const c = meshPoint(plan, i, j + 1);
  const d = meshPoint(plan, i + 1, j + 1);
  const x = (a.x * (1 - fx) + b.x * fx) * (1 - fy) + (c.x * (1 - fx) + d.x * fx) * fy;
  const y = (a.y * (1 - fx) + b.y * fx) * (1 - fy) + (c.y * (1 - fx) + d.y * fx) * fy;
  return { x: x * source.width, y: y * source.height };
}

export function toSourceBox(
  plan: DewarpPlan,
  box: BBox,
  source: { width: number; height: number },
): BBox {
  const steps = 8;
  const points = Array.from({ length: steps + 1 }, (_, i) => i / steps).flatMap((t) => [
    { x: box.x + t * box.width, y: box.y },
    { x: box.x + t * box.width, y: box.y + box.height },
    { x: box.x, y: box.y + t * box.height },
    { x: box.x + box.width, y: box.y + t * box.height },
  ]);
  const mapped = points.map((point) => toSource(plan, point, source));
  const xs = mapped.map((point) => point.x);
  const ys = mapped.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function applyDewarp(
  image: RgbaImage,
  plan: DewarpPlan,
): { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> } {
  const { width: outWidth, height: outHeight } = outputSize(plan, image);
  const out = new Uint8ClampedArray(outWidth * outHeight * 4).fill(255);
  const rowX = new Float64Array(plan.columns);
  const rowY = new Float64Array(plan.columns);
  const { width, height, data } = image;
  for (let y = 0; y < outHeight; y += 1) {
    const my = Math.min(plan.rows - 1, ((y + 0.5) / outHeight) * (plan.rows - 1));
    const j = Math.min(plan.rows - 2, Math.floor(my));
    const fy = my - j;
    for (let i = 0; i < plan.columns; i += 1) {
      const top = meshPoint(plan, i, j);
      const bottom = meshPoint(plan, i, j + 1);
      rowX[i] = (top.x * (1 - fy) + bottom.x * fy) * width - 0.5;
      rowY[i] = (top.y * (1 - fy) + bottom.y * fy) * height - 0.5;
    }
    for (let x = 0; x < outWidth; x += 1) {
      const mx = Math.min(plan.columns - 1, ((x + 0.5) / outWidth) * (plan.columns - 1));
      const i = Math.min(plan.columns - 2, Math.floor(mx));
      const fx = mx - i;
      const sx = (rowX[i] ?? 0) * (1 - fx) + (rowX[i + 1] ?? 0) * fx;
      const sy = (rowY[i] ?? 0) * (1 - fx) + (rowY[i + 1] ?? 0) * fx;
      if (sx < -0.5 || sy < -0.5 || sx > width - 0.5 || sy > height - 0.5) continue;
      const cx = Math.max(0, Math.min(width - 1, sx));
      const cy = Math.max(0, Math.min(height - 1, sy));
      const x0 = Math.min(width - 2, Math.floor(cx));
      const y0 = Math.min(height - 2, Math.floor(cy));
      const ax = cx - x0;
      const ay = cy - y0;
      const p00 = (y0 * width + x0) * 4;
      const p10 = p00 + 4;
      const p01 = p00 + width * 4;
      const p11 = p01 + 4;
      const target = (y * outWidth + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = (data[p00 + channel] ?? 0) * (1 - ax) + (data[p10 + channel] ?? 0) * ax;
        const bottom = (data[p01 + channel] ?? 0) * (1 - ax) + (data[p11 + channel] ?? 0) * ax;
        out[target + channel] = top * (1 - ay) + bottom * ay;
      }
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}
