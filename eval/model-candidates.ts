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
  contextSize?: number;
  maxOutputTokens?: number;
}

interface DraftFile {
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
  {
    id: 'gemma-4-e2b-q8',
    displayName: 'Gemma 4 E2B it (Q8_0)',
    license: 'Apache-2.0',
    recommendedRamGb: 16,
    repo: 'ggml-org/gemma-4-E2B-it-GGUF',
    commit: '6938c58e698502037401a5f19f6905f2fb2f7dee',
    name: 'gemma-4-E2B-it-Q8_0.gguf',
    sha256: '996d08777aadc6bfd3c7375ef70ba25a0f55240075860754fdb18d6d860aa63a',
    bytes: 4967497152,
  },
  {
    id: 'gemma-4-e4b-q8',
    displayName: 'Gemma 4 E4B it (Q8_0)',
    license: 'Apache-2.0',
    recommendedRamGb: 16,
    repo: 'ggml-org/gemma-4-E4B-it-GGUF',
    commit: 'a69f018d7678a2b9f5e705f8903d6fb29b9b25dc',
    name: 'gemma-4-E4B-it-Q8_0.gguf',
    sha256: '34be82b17b4942d389b9b527170c4b058027abdd32531fda063d3d97dd8ce80a',
    bytes: 8031242688,
  },
  {
    id: 'gemma-4-e4b-q4-denken',
    displayName: 'Gemma 4 E4B it (Q4_0) mit Denken',
    license: 'Apache-2.0',
    recommendedRamGb: 16,
    repo: 'ggml-org/gemma-4-E4B-it-GGUF',
    commit: 'a69f018d7678a2b9f5e705f8903d6fb29b9b25dc',
    name: 'gemma-4-E4B-it-Q4_0.gguf',
    sha256: 'a555b900214b477d8880e7832e0b8925e139b0159640036b09fe472b6f2097f2',
    bytes: 4590807392,
    contextSize: 12288,
    maxOutputTokens: 8192,
  },
  {
    id: 'gemma-4-26b-a4b-q4',
    displayName: 'Gemma 4 26B A4B it (Q4_0)',
    license: 'Apache-2.0',
    recommendedRamGb: 32,
    repo: 'ggml-org/gemma-4-26B-A4B-it-GGUF',
    commit: '9cf8c8db0f83fb4582f15381f8fb1a7c1b0b9ca2',
    name: 'gemma-4-26B-A4B-it-Q4_0.gguf',
    sha256: 'd208665ab1cd3a69f7a9a4bc59430e8448c8093d9b06334f566ac59d6d504a03',
    bytes: 14618145824,
  },
  {
    id: 'qwen3.6-35b-a3b-q4',
    displayName: 'Qwen3.6 35B A3B (Q4_K_M)',
    license: 'Apache-2.0',
    recommendedRamGb: 32,
    repo: 'ggml-org/Qwen3.6-35B-A3B-GGUF',
    commit: '7878dc9a905c7c9379e5e8d6a1aa9affdd6839c5',
    name: 'Qwen3.6-35B-A3B-Q4_K_M.gguf',
    sha256: '671e47e0ec53c665d048b98c3ecbfd5236b5ca9c3e02ed19fc8f81f7b85140c7',
    bytes: 20419565568,
  },
  {
    id: 'qwen3.5-9b-q4',
    displayName: 'Qwen3.5 9B (Q4_K_M)',
    license: 'Apache-2.0',
    recommendedRamGb: 16,
    repo: 'unsloth/Qwen3.5-9B-GGUF',
    commit: '3885219b6810b007914f3a7950a8d1b469d598a5',
    name: 'Qwen3.5-9B-Q4_K_M.gguf',
    sha256: '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8',
    bytes: 5680522464,
  },
];

const DRAFTS: Readonly<Record<string, DraftFile>> = {
  'mtp-gemma-4-e2b': {
    repo: 'ggml-org/gemma-4-E2B-it-GGUF',
    commit: '6938c58e698502037401a5f19f6905f2fb2f7dee',
    name: 'mtp-gemma-4-E2B-it-Q4_0.gguf',
    sha256: '718d3a44057924d5840c65a0aeedf7929366adeeda92a2006955ccabaf645ef4',
    bytes: 59235872,
  },
  'mtp-gemma-4-e4b': {
    repo: 'ggml-org/gemma-4-E4B-it-GGUF',
    commit: 'a69f018d7678a2b9f5e705f8903d6fb29b9b25dc',
    name: 'mtp-gemma-4-E4B-it-Q4_0.gguf',
    sha256: 'd19a11e4fd5019967d9296f77f4d3e139c8903909f70c3a9cf009c9af4b9b88d',
    bytes: 59678240,
  },
  'mtp-gemma-4-26b-a4b': {
    repo: 'ggml-org/gemma-4-26B-A4B-it-GGUF',
    commit: '9cf8c8db0f83fb4582f15381f8fb1a7c1b0b9ca2',
    name: 'mtp-gemma-4-26B-A4B-it-Q4_0.gguf',
    sha256: 'e00b0ce326d03d8f6f6972ad2320fe90b6ff25a3da5fc51bec15efe283052aa2',
    bytes: 251939520,
  },
};

const fileUrl = (file: { repo: string; commit: string; name: string }) =>
  `https://huggingface.co/${file.repo}/resolve/${file.commit}/${file.name}`;

export function draftFiles() {
  return Object.entries(DRAFTS).map(([id, draft]) => ({
    id,
    file: { name: draft.name, url: fileUrl(draft), sha256: draft.sha256, bytes: draft.bytes },
  }));
}

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
    server: { ...base.server, contextSize: candidate.contextSize ?? base.server.contextSize },
    request: {
      ...base.request,
      maxOutputTokens: candidate.maxOutputTokens ?? base.request.maxOutputTokens,
    },
    files: {
      model: {
        name: candidate.name,
        url: fileUrl(candidate),
        sha256: candidate.sha256,
        bytes: candidate.bytes,
      },
    },
  }));
}
