import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

export interface Dictionary {
  isWord(word: string): boolean;
  learn(words: Iterable<string>): Promise<void>;
  save(): Promise<void>;
}

function hunspellUnknown(dictionary: string, words: readonly string[]): Promise<Set<string>> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'hunspell',
      ['-d', dictionary, '-l', '-i', 'utf-8'],
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(new Set(stdout.split('\n').filter((line) => line !== '')));
      },
    );
    child.stdin?.end(words.join('\n'));
  });
}

export async function openDictionary(cacheFile: string, hunspellDictionary?: string) {
  const known = new Map<string, boolean>(
    existsSync(cacheFile) ? Object.entries(JSON.parse(await readFile(cacheFile, 'utf8'))) : [],
  );
  const dictionary: Dictionary = {
    isWord(word) {
      const value = known.get(word);
      if (value === undefined) throw new Error(`Wort nicht nachgeschlagen: ${word}`);
      return value;
    },
    async learn(words) {
      const missing = [...new Set(words)].filter((word) => !known.has(word));
      if (missing.length === 0) return;
      if (hunspellDictionary === undefined) {
        throw new Error(`${missing.length} Wörter fehlen im Cache, --hunspell angeben`);
      }
      const unknown = await hunspellUnknown(hunspellDictionary, missing);
      for (const word of missing) known.set(word, !unknown.has(word));
    },
    async save() {
      const sorted = [...known].toSorted(([a], [b]) => a.localeCompare(b));
      await writeFile(cacheFile, `${JSON.stringify(Object.fromEntries(sorted))}\n`);
    },
  };
  return dictionary;
}
