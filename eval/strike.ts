import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { readJpeg } from '../src/layout/image-files.ts';
import { findStruckWords, STRIKE_OPTIONS, type StrikeOptions } from '../src/layout/strike.ts';
import { parseTranscript } from '../src/pipeline/transcript-lines.ts';
import type { OcrRun } from './ocr-run.ts';
import { scoreStrikes, sumScores, tokens, type StrikeScore, type Token } from './strike-score.ts';

const MARKUP = /<(del|s|strike)>([\s\S]*?)<\/\1>/giu;

export function canonicalStrikes(text: string): string {
  return text.replace(MARKUP, (_, _tag: string, inner: string) =>
    inner
      .split(/\s+/u)
      .filter((word) => word !== '')
      .map((word) => `~~${word}~~`)
      .join(' '),
  );
}

const OPTIONS: StrikeOptions = {
  ...STRIKE_OPTIONS,
  ...JSON.parse(process.env['STRIKE_OPTIONS'] ?? '{}'),
};

function inkTokens(lines: readonly string[], imagePath: string) {
  const plain = lines.map((line) =>
    tokens(line)
      .map((token) => token.word)
      .join(' '),
  );
  const struckWords = findStruckWords(readJpeg(imagePath), plain, OPTIONS);
  return lines.flatMap((line, index): Token[] => {
    const struck = new Set(struckWords[index] ?? []);
    return tokens(line).map((token, at) => ({ ...token, struck: token.struck || struck.has(at) }));
  });
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '–' : `${((100 * part) / whole).toFixed(1)} %`;
}

function main() {
  const { values } = parseArgs({
    options: {
      ocr: { type: 'string' },
      images: { type: 'string' },
      truth: { type: 'string' },
      method: { type: 'string', default: 'none' },
      verbose: { type: 'boolean', default: false },
    },
  });
  if (!values.ocr || !values.truth) throw new Error('--ocr und --truth angeben');
  const run: OcrRun = JSON.parse(readFileSync(values.ocr, 'utf8'));
  const useInk = values.method === 'ink' || values.method === 'both';
  const usePrompt = values.method === 'prompt' || values.method === 'both';
  const scores: StrikeScore[] = [];
  let inkSeconds = 0;
  let ocrSeconds = 0;
  for (const page of run.pages) {
    const truthFile = join(values.truth, `${page.name}.txt`);
    if (!existsSync(truthFile)) continue;
    const content = usePrompt
      ? canonicalStrikes(page.content)
      : canonicalStrikes(page.content).replace(/~~/gu, '');
    const lines = parseTranscript(content).lines;
    let hypothesis = lines.flatMap((line) => tokens(line));
    if (useInk) {
      const image = ['.jpg', '.jpeg']
        .map((ext) => join(values.images ?? '', `${page.name}${ext}`))
        .find(existsSync);
      if (image === undefined) throw new Error(`Kein Bild für ${page.name}`);
      const started = performance.now();
      hypothesis = inkTokens(lines, image);
      inkSeconds += (performance.now() - started) / 1000;
    }
    ocrSeconds += page.seconds;
    const score = scoreStrikes(tokens(readFileSync(truthFile, 'utf8')), hypothesis);
    scores.push(score);
    if (values.verbose) {
      const flagged = hypothesis.filter((token) => token.struck).map((token) => token.word);
      console.log(`${page.name}: ${JSON.stringify(score)} ${flagged.join(' ')}`);
    }
  }
  const total = sumScores(scores);
  console.log(`Seiten: ${scores.length}, Wörter (Soll ohne Gestrichenes): ${total.truthWords}`);
  console.log(
    `Gestrichen: ${total.struck}, erkannt ${total.detected} (${percent(total.detected, total.struck)}), ungekennzeichnet abgeschrieben ${total.transcribed}, ausgelassen ${total.omitted}`,
  );
  console.log(
    `Fehlalarme: ${total.falseAlarms} (${percent(total.falseAlarms, total.truthWords)} der Wörter)`,
  );
  const countErrors = scores.map((score) => Math.abs(score.countedWords - score.truthWords));
  console.log(
    `Wortzahl: ${total.countedWords} statt ${total.truthWords}, mittlere Abweichung je Seite ${(countErrors.reduce((a, b) => a + b, 0) / Math.max(1, scores.length)).toFixed(2)} Wörter (${percent(
      countErrors.reduce((a, b) => a + b, 0),
      total.truthWords,
    )})`,
  );
  console.log(`WER (ohne Gestrichenes): ${percent(total.wordEdits, total.truthWords)}`);
  console.log(
    `Zeit je Seite: Erkennung ${(ocrSeconds / Math.max(1, scores.length)).toFixed(1)} s, Tinte ${(inkSeconds / Math.max(1, scores.length)).toFixed(2)} s`,
  );
}

if (import.meta.main) main();
