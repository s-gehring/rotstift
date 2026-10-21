import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyModelInfo, CorrectorInfo } from '../src/models/registry.ts';
import { evalDir } from './paths.ts';

interface TextCandidate {
  id: string;
  displayName: string;
  license: string;
  recommendedRamGb: number;
  repo: string;
  commit: string;
  name: string;
  sha256: string;
  bytes: number;
}

const STEP_TEMPLATE_ID = 'gemma-4-e2b-q4';

const TEXT_CANDIDATES: readonly TextCandidate[] = [
  {
    id: 'gemma-4-e4b-q4',
    displayName: 'Gemma 4 E4B it (Q4_0)',
    license: 'Apache-2.0',
    recommendedRamGb: 16,
    repo: 'ggml-org/gemma-4-E4B-it-GGUF',
    commit: 'a69f018d7678a2b9f5e705f8903d6fb29b9b25dc',
    name: 'gemma-4-E4B-it-Q4_0.gguf',
    sha256: 'a555b900214b477d8880e7832e0b8925e139b0159640036b09fe472b6f2097f2',
    bytes: 4590807392,
  },
  {
    id: 'granite-4.2-3b-q4',
    displayName: 'Granite 4.2 3B (Q4_K_M)',
    license: 'Apache-2.0',
    recommendedRamGb: 8,
    repo: 'ibm-granite/granite-4.2-3b-GGUF',
    commit: 'c40945d71cd90f249a56985e8155551a9188dc30',
    name: 'granite-4.2-3b-Q4_K_M.gguf',
    sha256: 'e0406663965846ae22a403456eb826ccce5f450840491f71952f18a7cb78e7d5',
    bytes: 2244011552,
  },
  {
    id: 'qwen3.5-4b-q4',
    displayName: 'Qwen3.5 4B (Q4_K_M)',
    license: 'Apache-2.0',
    recommendedRamGb: 8,
    repo: 'unsloth/Qwen3.5-4B-GGUF',
    commit: 'e87f176479d0855a907a41277aca2f8ee7a09523',
    name: 'Qwen3.5-4B-Q4_K_M.gguf',
    sha256: '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',
    bytes: 2740937888,
  },
];

function defaultCorrector(): CorrectorInfo {
  const json: { models: AnyModelInfo[] } = JSON.parse(
    readFileSync(join(evalDir, '..', 'src-tauri', 'models.json'), 'utf8'),
  );
  const found = json.models.find((model) => model.id === STEP_TEMPLATE_ID);
  if (found?.role !== 'corrector') throw new Error(`Kein Korrekturmodell ${STEP_TEMPLATE_ID}`);
  return found;
}

export function candidateCorrectors(): CorrectorInfo[] {
  const base = defaultCorrector();
  return TEXT_CANDIDATES.map((candidate) => ({
    ...base,
    id: candidate.id,
    displayName: candidate.displayName,
    license: candidate.license,
    recommendedRamGb: candidate.recommendedRamGb,
    files: {
      model: {
        name: candidate.name,
        url: `https://huggingface.co/${candidate.repo}/resolve/${candidate.commit}/${candidate.name}`,
        sha256: candidate.sha256,
        bytes: candidate.bytes,
      },
    },
  }));
}
