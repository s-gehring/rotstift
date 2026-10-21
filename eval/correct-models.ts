import { CANDIDATES } from './models.ts';
import type { ModelFile } from './models.ts';

export interface Corrector {
  id: string;
  label: string;
  repo: string;
  commit: string;
  model: ModelFile;
  license: string;
}

const file = (name: string, sha256: string, bytes: number): ModelFile => ({ name, sha256, bytes });

const TEXT_MODELS: readonly Corrector[] = [
  {
    id: 'qwen3-1.7b',
    label: 'Qwen3 1.7B (Q8_0)',
    repo: 'Qwen/Qwen3-1.7B-GGUF',
    commit: '90862c4b9d2787eaed51d12237eafdfe7c5f6077',
    model: file(
      'Qwen3-1.7B-Q8_0.gguf',
      '061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a',
      1834426016,
    ),
    license: 'Apache-2.0',
  },
  {
    id: 'qwen3-4b',
    label: 'Qwen3 4B (Q4_K_M)',
    repo: 'Qwen/Qwen3-4B-GGUF',
    commit: 'bc640142c66e1fdd12af0bd68f40445458f3869b',
    model: file(
      'Qwen3-4B-Q4_K_M.gguf',
      '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
      2497280256,
    ),
    license: 'Apache-2.0',
  },
  {
    id: 'qwen3-4b-instruct-2507',
    label: 'Qwen3 4B Instruct 2507 (Q8_0)',
    repo: 'ggml-org/Qwen3-4B-Instruct-2507-Q8_0-GGUF',
    commit: 'e6f794d44f9395d0184a966c27b5ae99ea356fcb',
    model: file(
      'qwen3-4b-instruct-2507-q8_0.gguf',
      'ae916ede1c010a26955ee8ae2e908bf8815a3f135ec860439ab924701c69d5f1',
      4280403520,
    ),
    license: 'Apache-2.0',
  },
  {
    id: 'qwen3.5-0.8b',
    label: 'Qwen3.5 0.8B (Q8_0)',
    repo: 'ggml-org/Qwen3.5-0.8B-GGUF',
    commit: '807dfd9a6fadbf703207aac3bfb0b2b3040d077c',
    model: file(
      'Qwen3.5-0.8B-Q8_0.gguf',
      '37ae482d336108d23516fa35e8e0c4126688d81018b87178a18d752a1357814f',
      833592096,
    ),
    license: 'Apache-2.0',
  },
  {
    id: 'gemma-4-e2b-text',
    label: 'Gemma 4 E2B it (Q4_0)',
    repo: 'ggml-org/gemma-4-E2B-it-GGUF',
    commit: '6938c58e698502037401a5f19f6905f2fb2f7dee',
    model: file(
      'gemma-4-E2B-it-Q4_0.gguf',
      '8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52',
      2841481184,
    ),
    license: 'Apache-2.0',
  },
  {
    id: 'gemma-4-e4b-text',
    label: 'Gemma 4 E4B it (Q4_0)',
    repo: 'ggml-org/gemma-4-E4B-it-GGUF',
    commit: 'a69f018d7678a2b9f5e705f8903d6fb29b9b25dc',
    model: file(
      'gemma-4-E4B-it-Q4_0.gguf',
      'a555b900214b477d8880e7832e0b8925e139b0159640036b09fe472b6f2097f2',
      4590807392,
    ),
    license: 'Apache-2.0',
  },
  {
    id: 'ministral-3-3b',
    label: 'Ministral 3 3B Instruct (Q4_K_M)',
    repo: 'mistralai/Ministral-3-3B-Instruct-2512-GGUF',
    commit: 'eb599d408350ea2bb60452cb86be7c7b2fc28227',
    model: file(
      'Ministral-3-3B-Instruct-2512-Q4_K_M.gguf',
      '9ed150d4367e68df0ac8e1540f6ddc65b42d0ee26378329d1ecbca60f93fc5f8',
      2147023008,
    ),
    license: 'Apache-2.0',
  },
  {
    id: 'smollm3-3b',
    label: 'SmolLM3 3B (Q4_K_M)',
    repo: 'ggml-org/SmolLM3-3B-GGUF',
    commit: '4965cb60b150737b68a0408c36aeefb65078f894',
    model: file(
      'SmolLM3-Q4_K_M.gguf',
      '8334b850b7bd46238c16b0c550df2138f0889bf433809008cc17a8b05761863e',
      1915305312,
    ),
    license: 'Apache-2.0',
  },
  {
    id: 'granite-4.1-3b',
    label: 'Granite 4.1 3B (Q4_K_M)',
    repo: 'ibm-granite/granite-4.1-3b-GGUF',
    commit: 'ab4701481089b58a082ef63cc1cee738887293ff',
    model: file(
      'granite-4.1-3b-Q4_K_M.gguf',
      '662b0626cd58f443baea23559b469df6576a81d349649c59413b36a9fb32eb29',
      2099501664,
    ),
    license: 'Apache-2.0',
  },
  {
    id: 'granite-4.2-3b',
    label: 'Granite 4.2 3B (Q4_K_M)',
    repo: 'ibm-granite/granite-4.2-3b-GGUF',
    commit: 'c40945d71cd90f249a56985e8155551a9188dc30',
    model: file(
      'granite-4.2-3b-Q4_K_M.gguf',
      'e0406663965846ae22a403456eb826ccce5f450840491f71952f18a7cb78e7d5',
      2244011552,
    ),
    license: 'Apache-2.0',
  },
  {
    id: 'qwen3.5-4b',
    label: 'Qwen3.5 4B (Q4_K_M)',
    repo: 'unsloth/Qwen3.5-4B-GGUF',
    commit: 'e87f176479d0855a907a41277aca2f8ee7a09523',
    model: file(
      'Qwen3.5-4B-Q4_K_M.gguf',
      '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',
      2740937888,
    ),
    license: 'Apache-2.0',
  },
];

const VISION_COMMITS: Record<string, string> = {
  'glm-ocr': '65a42de1148dbed2297e922b5dbc7d9b70c36578',
  'qwen3-vl-2b-q4': '52d6c8ffea26cc873ac5ad116f8631268d7eb503',
  'qwen3-vl-4b': '1cd86afb9a95c410a6038ab3b40d8b578c892266',
};

const VISION_AS_TEXT: readonly Corrector[] = Object.entries(VISION_COMMITS).map(([id, commit]) => {
  const candidate = CANDIDATES.find((entry) => entry.id === id);
  if (!candidate) throw new Error(`Unknown vision model ${id}`);
  return {
    id: `${id}-text`,
    label: `${candidate.label}, nur Text`,
    repo: candidate.repo,
    commit,
    model: candidate.model,
    license: candidate.license,
  };
});

export const CORRECTORS: readonly Corrector[] = [...TEXT_MODELS, ...VISION_AS_TEXT];
