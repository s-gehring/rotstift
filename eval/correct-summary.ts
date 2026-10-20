import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { correctorReport } from './correct-report.ts';
import type { CorrectorRun } from './correct-report.ts';

function main() {
  const folders = process.argv.slice(2);
  if (folders.length === 0) throw new Error('Usage: correct-summary.ts <results folder>...');
  const runs: CorrectorRun[] = folders.flatMap((folder) =>
    readdirSync(folder)
      .filter((name) => name.endsWith('.json'))
      .toSorted()
      .map((name) => JSON.parse(readFileSync(join(folder, name), 'utf8'))),
  );
  console.log(correctorReport(runs, `Ergebnisse: ${folders.join(', ')}`));
}

main();
