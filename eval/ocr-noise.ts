export interface CharEdit {
  from: string;
  to: string;
}

export interface NoiseModel {
  words: number;
  misreadWords: number;
  editsPerWord: number[];
  edits: CharEdit[];
}

function editTable(
  a: readonly string[],
  b: readonly string[],
  same: (x: string, y: string) => boolean,
) {
  const columns = b.length + 1;
  const cost = new Uint32Array((a.length + 1) * columns);
  for (let j = 0; j <= b.length; j++) cost[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cost[i * columns] = i;
    for (let j = 1; j <= b.length; j++) {
      const change = same(a[i - 1] ?? '', b[j - 1] ?? '') ? 0 : 1;
      cost[i * columns + j] = Math.min(
        (cost[(i - 1) * columns + j - 1] ?? 0) + change,
        (cost[(i - 1) * columns + j] ?? 0) + 1,
        (cost[i * columns + j - 1] ?? 0) + 1,
      );
    }
  }
  return { cost, columns };
}

type Step =
  | { type: 'same' | 'sub'; a: string; b: string }
  | { type: 'del'; a: string }
  | { type: 'ins'; b: string };

function alignSequences(
  a: readonly string[],
  b: readonly string[],
  same: (x: string, y: string) => boolean,
): Step[] {
  const { cost, columns } = editTable(a, b, same);
  const steps: Step[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    const here = cost[i * columns + j] ?? 0;
    const x = a[i - 1] ?? '';
    const y = b[j - 1] ?? '';
    if (i > 0 && j > 0 && here === (cost[(i - 1) * columns + j - 1] ?? 0) + (same(x, y) ? 0 : 1)) {
      steps.push({ type: same(x, y) ? 'same' : 'sub', a: x, b: y });
      i--;
      j--;
    } else if (i > 0 && here === (cost[(i - 1) * columns + j] ?? 0) + 1) {
      steps.push({ type: 'del', a: x });
      i--;
    } else {
      steps.push({ type: 'ins', b: y });
      j--;
    }
  }
  return steps.toReversed();
}

export function charEdits(truth: string, read: string): CharEdit[] {
  return alignSequences(Array.from(truth), Array.from(read), (x, y) => x === y).flatMap(
    (step): CharEdit[] => {
      if (step.type === 'same') return [];
      if (step.type === 'sub') return [{ from: step.a, to: step.b }];
      if (step.type === 'del') return [{ from: step.a, to: '' }];
      return [{ from: '', to: step.b }];
    },
  );
}

export function learnNoise(pairs: readonly { truth: string; read: string }[]): NoiseModel {
  const model: NoiseModel = { words: 0, misreadWords: 0, editsPerWord: [], edits: [] };
  for (const { truth, read } of pairs) {
    const a = truth.split(/\s+/u).filter(Boolean);
    const b = read.split(/\s+/u).filter(Boolean);
    model.words += a.length;
    for (const step of alignSequences(a, b, (x, y) => x === y)) {
      if (step.type !== 'sub') continue;
      const edits = charEdits(step.a, step.b);
      model.misreadWords += 1;
      model.editsPerWord.push(edits.length);
      model.edits.push(...edits);
    }
  }
  return model;
}

export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], next: () => number): T | undefined {
  return items[Math.floor(next() * items.length)];
}

function applyEdit(word: string, edit: CharEdit, next: () => number): string | null {
  const chars = Array.from(word);
  if (edit.from === '') {
    const at = Math.floor(next() * (chars.length + 1));
    chars.splice(at, 0, edit.to);
    return chars.join('');
  }
  const positions = chars.flatMap((char, index) => (char === edit.from ? [index] : []));
  const at = pick(positions, next);
  if (at === undefined) return null;
  chars.splice(at, 1, ...(edit.to === '' ? [] : [edit.to]));
  const result = chars.join('');
  return result === '' ? null : result;
}

export function misread(word: string, model: NoiseModel, next: () => number): string {
  const count = pick(model.editsPerWord, next) ?? 1;
  let result = word;
  for (let done = 0, tries = 0; done < count && tries < 50; tries++) {
    const edit = pick(model.edits, next);
    const changed = edit ? applyEdit(result, edit, next) : null;
    if (changed === null || changed === result) continue;
    result = changed;
    done++;
  }
  return result;
}

export function addNoise(lines: readonly string[], model: NoiseModel, seed: number): string[] {
  const next = random(seed);
  const rate = model.words === 0 ? 0 : model.misreadWords / model.words;
  return lines.map((line) =>
    line.replaceAll(/\S+/gu, (word) => (next() < rate ? misread(word, model, next) : word)),
  );
}
