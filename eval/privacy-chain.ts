import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDictionaryDetector, wordForms } from '../src/privacy/dictionary.ts';
import { createModelDetector, type AskModel } from '../src/privacy/model-detector.ts';
import { createDetectWork, DETECTORS } from '../src/privacy-review/detect.ts';
import type { PrivacySpan as AppSpan } from '../src/privacy/types.ts';
import { privacyCache } from './privacy-inputs.ts';
import type { WorkInput } from './privacy-inputs.ts';
import type { PrivacySpan } from './privacy-sample.ts';
import { evalDir } from './paths.ts';

export const E2B = 'gemma-4-e2b-q4';
export const E4B = 'gemma-4-e4b-q4';

const SPELLING_CACHE = () => join(privacyCache(), 'spellbook.json');

export function spellbook(allForms: readonly string[]): (word: string) => boolean {
  const file = SPELLING_CACHE();
  const known: Record<string, boolean> = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : {};
  const missing = [...new Set(allForms)].filter((word) => !(word in known));
  if (missing.length > 0) {
    const output = execFileSync(
      'cargo',
      [
        'run',
        '-q',
        '--release',
        '--manifest-path',
        join(evalDir, '..', 'src-tauri', 'Cargo.toml'),
        '--example',
        'unknown_words',
      ],
      { input: missing.join('\n'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const unknown = new Set(output.split('\n').filter(Boolean));
    for (const word of missing) known[word] = !unknown.has(word);
    writeFileSync(file, `${JSON.stringify(known)}\n`);
  }
  return (word) => known[word] === true;
}

export function candidateForms(inputs: readonly WorkInput[]): string[] {
  return inputs.flatMap((input) =>
    [...input.lines.join('\n').matchAll(/\p{Lu}[\p{L}'’]*/gu)].flatMap((match) =>
      wordForms(match[0]),
    ),
  );
}

export interface ChainOptions {
  readonly models: readonly string[];
  readonly ask: AskModel;
  readonly isWord: (word: string) => boolean;
  readonly loaded?: () => string | null;
}

export async function runChain(input: WorkInput, options: ChainOptions): Promise<PrivacySpan[]> {
  const { models, ask, isWord, loaded } = options;
  const detectors = [
    ...DETECTORS,
    createDictionaryDetector(async (words) => new Set(words.filter((word) => !isWord(word)))),
    ...(models.length === 0
      ? []
      : [
          createModelDetector({
            models,
            sensitiveModel: models.includes(E4B) ? E4B : E2B,
            ask,
            ...(loaded && { loaded }),
          }),
        ]),
  ];
  const pages = await createDetectWork(detectors)(
    [{ pageId: input.id, lines: input.lines }],
    input.context,
    AbortSignal.timeout(600_000),
  );
  return (pages[0]?.spans ?? []).map((span: AppSpan) => ({ ...span }));
}
