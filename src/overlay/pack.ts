export interface PackItem {
  readonly center: number;
  readonly width: number;
}

export function packRow(
  items: readonly PackItem[],
  left: number,
  right: number,
  gap: number,
): number[] | null {
  const starts: number[] = [];
  let cursor = left;
  for (const item of items) {
    const start = Math.max(cursor, item.center - item.width / 2);
    starts.push(start);
    cursor = start + item.width + gap;
  }
  let limit = right;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const start = starts[index];
    if (item === undefined || start === undefined) continue;
    const shifted = Math.min(start, limit - item.width);
    starts[index] = shifted;
    limit = shifted - gap;
  }
  const first = starts[0];
  if (first !== undefined && first < left - 1e-6) return null;
  return starts;
}

export interface FitResult {
  readonly size: number;
  readonly starts: number[];
}

export function fitRow(
  items: readonly { readonly center: number; readonly units: number }[],
  sizes: readonly number[],
  limits: (size: number) => { left: number; right: number },
  emPerUnit: number,
  gapEm: number,
): FitResult | null {
  for (const size of sizes) {
    const { left, right } = limits(size);
    const starts = packRow(
      items.map((item) => ({ center: item.center, width: item.units * emPerUnit * size })),
      left,
      right,
      gapEm * size,
    );
    if (starts !== null) return { size, starts };
  }
  return null;
}

export function sizeLadder(start: number, minimum: number, factor = 0.92): number[] {
  const sizes: number[] = [];
  let size = start;
  while (size > minimum) {
    sizes.push(size);
    size *= factor;
  }
  sizes.push(minimum);
  return sizes;
}
