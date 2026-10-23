import { describe, expect, it } from 'vitest';
import {
  analyzeDewarp,
  applyDewarp,
  outputSize,
  planDewarp,
  toSource,
  toSourceBox,
} from './dewarp.ts';
import type { DewarpPlan } from './dewarp.ts';
import { locateLines } from './locate-lines.ts';
import {
  cameraCorners,
  gridSheet,
  photograph,
  photographBox,
  ruledSheet,
} from './synthetic-photo.ts';
import { iou, sampleLines } from './synthetic.ts';

const CORNERS = cameraCorners(620, 877);
const LINES = sampleLines(11, 18, 22, 32);

describe('planDewarp', () => {
  it('finds a photographed sheet on a table and maps the output corners onto it', () => {
    const photo = photograph(ruledSheet(), CORNERS, 800, 1000);
    const plan = planDewarp(photo);
    expect(plan).not.toBeNull();
    if (plan === null) return;
    const size = outputSize(plan, photo);
    const outputCorners = [
      { x: 0, y: 0 },
      { x: size.width, y: 0 },
      { x: size.width, y: size.height },
      { x: 0, y: size.height },
    ];
    outputCorners.forEach((corner, i) => {
      const mapped = toSource(plan, corner, photo);
      const truth = CORNERS[i] ?? { x: 0, y: 0 };
      expect(Math.hypot(mapped.x - truth.x, mapped.y - truth.y)).toBeLessThan(8);
    });
    expect(size.width / size.height).toBeCloseTo(620 / 877, 2);
  });

  it('leaves flat and slightly crooked scans unchanged', () => {
    expect(planDewarp(ruledSheet())).toBeNull();
    expect(planDewarp(ruledSheet(0.9))).toBeNull();
    expect(planDewarp(ruledSheet(-2.5))).toBeNull();
  });

  it('keeps the original when the found edge would cut off writing', () => {
    const shaded = ruledSheet();
    const data = new Uint8ClampedArray(shaded.data);
    for (let y = 0; y < 330; y += 1) {
      for (let x = 0; x < shaded.width; x += 1) {
        const at = (y * shaded.width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          data[at + channel] = Math.round((data[at + channel] ?? 0) * 0.55);
        }
      }
    }
    const report = analyzeDewarp({ ...shaded, data });
    expect(report.sheet).toBeNull();
    expect(report.plan).toBeNull();
  });
});

describe('planDewarp on a photo of grid paper', () => {
  it('straightens the sheet so that it needs no second pass and every line still hits', () => {
    const sheet = gridSheet();
    const photo = photograph(sheet.image, CORNERS, 800, 1000);
    const report = analyzeDewarp(photo);
    expect(report.sheet).not.toBeNull();
    const plan = report.plan;
    expect(plan).not.toBeNull();
    if (plan === null) return;
    const straight = applyDewarp(photo, plan);
    const again = analyzeDewarp(straight);
    expect(again.plan).toBeNull();
    expect(Math.abs(again.rotationDegrees)).toBeLessThan(0.5);
    const result = locateLines(straight, LINES);
    expect(result.ruling?.kind).toBe('grid');
    const boxes = sheet.truth.flatMap((box, index) =>
      box === null
        ? []
        : [{ truth: photographBox(box, CORNERS, sheet.image), found: result.lines[index] }],
    );
    const hits = boxes.filter(
      ({ truth, found }) =>
        found != null && iou(truth, toSourceBox(plan, found.bbox, photo)) >= 0.5,
    );
    expect(hits).toHaveLength(boxes.length);
  });
});

describe('applyDewarp', () => {
  const identity: DewarpPlan = {
    width: 1,
    height: 1,
    columns: 2,
    rows: 2,
    mesh: [0, 0, 1, 0, 0, 1, 1, 1],
  };

  it('reproduces the source pixel for pixel under an identity plan', () => {
    const source = ruledSheet();
    const out = applyDewarp(source, identity);
    expect(out.width).toBe(source.width);
    expect(out.height).toBe(source.height);
    expect(Buffer.from(out.data).equals(Buffer.from(source.data))).toBe(true);
  });

  it('maps output points back through the mesh', () => {
    const shifted: DewarpPlan = { ...identity, width: 0.5, mesh: [0.5, 0, 1, 0, 0.5, 1, 1, 1] };
    expect(toSource(shifted, { x: 0, y: 0 }, { width: 200, height: 100 })).toEqual({
      x: 100,
      y: 0,
    });
    expect(toSource(shifted, { x: 50, y: 50 }, { width: 200, height: 100 })).toEqual({
      x: 150,
      y: 50,
    });
  });
});
