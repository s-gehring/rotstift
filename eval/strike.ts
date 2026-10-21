import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { readJpeg } from '../src/layout/image-files.ts';
import { findStruckWords, STRIKE_OPTIONS, type StrikeOptions } from '../src/layout/strike.ts';
import { parseTranscript } from '../src/pipeline/transcript-lines.ts';
import type { OcrRun } from './ocr-run.ts';
import {
  scoreStrikes,
  strikeOutcomes,
  sumScores,
  tokens,
  type StrikeOutcome,
  type StrikeScore,
  type Token,
} from './strike-score.ts';

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

function strikeStyles(truthDir: string, name: string): string[] {
  const file = join(truthDir, `${name}.strikes.json`);
  if (!existsSync(file)) return [];
  const styles: unknown = JSON.parse(readFileSync(file, 'utf8')).styles;
  return Array.isArray(styles) ? styles.map(String) : [];
}

function main() {
  const { values } = parseArgs({
    options: {
      ocr: { type: 'string', multiple: true },
      images: { type: 'string', multiple: true },
      truth: { type: 'string', multiple: true },
      method: { type: 'string', default: 'none' },
      verbose: { type: 'boolean', default: false },
    },
  });
  if (!values.ocr || !values.truth || values.ocr.length !== values.truth.length)
    throw new Error('--ocr und --truth paarweise angeben');
  const useInk = values.method === 'ink' || values.method === 'both';
  const usePrompt = values.method === 'prompt' || values.method === 'both';
  const scores: StrikeScore[] = [];
  const byStyle = new Map<string, Map<StrikeOutcome, number>>();
  let inkSeconds = 0;
  let ocrSeconds = 0;
  values.ocr.forEach((ocrFile, set) => {
    const truthDir = values.truth?.[set] ?? '';
    const imageDir = values.images?.[set] ?? '';
    const run: OcrRun = JSON.parse(readFileSync(ocrFile, 'utf8'));
    for (const page of run.pages) {
      const truthFile = join(truthDir, `${page.name}.txt`);
      if (!existsSync(truthFile)) continue;
      const content = usePrompt
        ? canonicalStrikes(page.content)
        : canonicalStrikes(page.content).replace(/~~/gu, '');
      const lines = parseTranscript(content).lines;
      let hypothesis = lines.flatMap((line) => tokens(line));
      if (useInk) {
        const image = ['.jpg', '.jpeg']
          .map((ext) => join(imageDir, `${page.name}${ext}`))
          .find(existsSync);
        if (image === undefined) throw new Error(`Kein Bild für ${page.name}`);
        const started = performance.now();
        hypothesis = inkTokens(lines, image);
        inkSeconds += (performance.now() - started) / 1000;
      }
      ocrSeconds += page.seconds;
      const truth = tokens(readFileSync(truthFile, 'utf8'));
      const score = scoreStrikes(truth, hypothesis);
      scores.push(score);
      const styles = strikeStyles(truthDir, page.name);
      strikeOutcomes(truth, hypothesis).forEach((outcome, index) => {
        const style = styles[index] ?? 'unbekannt';
        const counts = byStyle.get(style) ?? new Map<StrikeOutcome, number>();
        counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
        byStyle.set(style, counts);
      });
      if (values.verbose) {
        const flagged = hypothesis.filter((token) => token.struck).map((token) => token.word);
        console.log(`${page.name}: ${JSON.stringify(score)} ${flagged.join(' ')}`);
      }
    }
  });
  const total = sumScores(scores);
  console.log(`Seiten: ${scores.length}, Wörter (Soll ohne Gestrichenes): ${total.truthWords}`);
  console.log(
    `Gestrichen: ${total.struck}, erkannt ${total.detected} (${percent(total.detected, total.struck)}), ungekennzeichnet abgeschrieben ${total.transcribed}, ausgelassen ${total.omitted}`,
  );
  console.log(
    `Fehlalarme: ${total.falseAlarms} (${percent(total.falseAlarms, total.truthWords)} der Wörter), Precision ${percent(total.detected, total.detected + total.falseAlarms)}`,
  );
  if (byStyle.size > 0) {
    console.log(
      '| Art | gestrichen | erkannt | abgeschrieben | ausgelassen | Recall (abgeschrieben) |',
    );
    for (const [style, counts] of [...byStyle].toSorted(([a], [b]) => a.localeCompare(b))) {
      const get = (outcome: StrikeOutcome) => counts.get(outcome) ?? 0;
      const all = get('detected') + get('transcribed') + get('omitted');
      console.log(
        `| ${style} | ${all} | ${get('detected')} | ${get('transcribed')} | ${get('omitted')} | ${percent(get('detected'), get('detected') + get('transcribed'))} |`,
      );
    }
  }
  console.log(
    `Recall der abgeschriebenen: ${percent(total.detected, total.detected + total.transcribed)}`,
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
