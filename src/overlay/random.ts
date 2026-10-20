export type Random = () => number;

export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFor(...parts: readonly number[]): number {
  let hash = 2166136261;
  for (const part of parts) {
    hash = Math.imul(hash ^ (part | 0), 16777619);
  }
  return hash >>> 0;
}

export function spread(random: Random, amount: number): number {
  return (random() * 2 - 1) * amount;
}
