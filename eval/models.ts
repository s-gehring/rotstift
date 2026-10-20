export interface ModelFile {
  name: string;
  sha256: string;
  bytes: number;
}

export interface Candidate {
  id: string;
  label: string;
  repo: string;
  model: ModelFile;
  mmproj: ModelFile;
  license: string;
  prompt: string | null;
}

export const TRANSCRIBE_PROMPT =
  'Transkribiere den handschriftlichen Text auf dem Bild buchstabengetreu. ' +
  'Korrigiere nichts: Rechtschreibung, Groß- und Kleinschreibung, Grammatik und Zeichensetzung ' +
  'bleiben genau so, wie sie geschrieben sind, auch wenn sie falsch sind. ' +
  'Behalte die Absätze bei. Gib nur den Text aus, ohne Einleitung und ohne Kommentar.';

export const STRICT_PROMPT =
  'Schreibe den handschriftlichen Text auf dem Bild Wort für Wort und Zeichen für Zeichen ab. ' +
  'Der Text stammt von einem Kind und enthält absichtlich Fehler, die erhalten bleiben müssen: ' +
  'falsche Rechtschreibung, falsche Groß- und Kleinschreibung, falsche Grammatik und fehlende ' +
  'oder falsche Satzzeichen. Verbessere kein einziges Wort, auch wenn es offensichtlich falsch ist. ' +
  'Behalte die Absätze bei. Gib nur den abgeschriebenen Text aus.';

export const STRICT_PROMPT_EN =
  'Copy the handwritten German text in the image word by word and character by character. ' +
  'It was written by a child and deliberately contains mistakes that must be kept: wrong spelling, ' +
  'wrong capitalization, wrong grammar and missing or wrong punctuation. Do not correct a single ' +
  'word, even if it is obviously wrong. Keep the paragraphs. Output only the copied text.';

export const PROMPTS: Record<string, string> = {
  standard: TRANSCRIBE_PROMPT,
  strict: STRICT_PROMPT,
  'strict-en': STRICT_PROMPT_EN,
};

const file = (name: string, sha256: string, bytes: number): ModelFile => ({ name, sha256, bytes });

export const CANDIDATES: readonly Candidate[] = [
  {
    id: 'qwen3-vl-2b',
    label: 'Qwen3-VL 2B Instruct (Q8_0)',
    repo: 'ggml-org/Qwen3-VL-2B-Instruct-GGUF',
    model: file(
      'Qwen3-VL-2B-Instruct-Q8_0.gguf',
      'b7802e29f71a9e5b5e3f83f613df898a2204342dcea71a231ea501d481813c39',
      1834427296,
    ),
    mmproj: file(
      'mmproj-Qwen3-VL-2B-Instruct-Q8_0.gguf',
      '69066c8f279ec85ff48ab4059f6ebba0d2932ca57667f2bbdac7d9805bca9e7b',
      445053056,
    ),
    license: 'Apache-2.0',
    prompt: TRANSCRIBE_PROMPT,
  },
  {
    id: 'qwen3-vl-2b-q4',
    label: 'Qwen3-VL 2B Instruct (Q4_K_M)',
    repo: 'Qwen/Qwen3-VL-2B-Instruct-GGUF',
    model: file(
      'Qwen3VL-2B-Instruct-Q4_K_M.gguf',
      '089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae',
      1107409952,
    ),
    mmproj: file(
      'mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf',
      'f9a68fabba69c3b81e153367b2c7521030b0fa8bb0de400c9599c8e6725f9c82',
      445053216,
    ),
    license: 'Apache-2.0',
    prompt: TRANSCRIBE_PROMPT,
  },
  {
    id: 'qwen3-vl-4b',
    label: 'Qwen3-VL 4B Instruct (Q4_K_M)',
    repo: 'Qwen/Qwen3-VL-4B-Instruct-GGUF',
    model: file(
      'Qwen3VL-4B-Instruct-Q4_K_M.gguf',
      '66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a',
      2497281664,
    ),
    mmproj: file(
      'mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf',
      '30ba2c7dd3127a4561b6cba9d13d0f711c91bdb38742e2f56d73c8cb596bd06d',
      453974304,
    ),
    license: 'Apache-2.0',
    prompt: TRANSCRIBE_PROMPT,
  },
  {
    id: 'gemma-4-e2b',
    label: 'Gemma 4 E2B it (Q4_0)',
    repo: 'ggml-org/gemma-4-E2B-it-GGUF',
    model: file(
      'gemma-4-E2B-it-Q4_0.gguf',
      '8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52',
      2841481184,
    ),
    mmproj: file(
      'mmproj-gemma-4-E2B-it-Q8_0.gguf',
      '9406f99c16d68cda4f1f0552192dcc99021ea1fc6d2fd50b1dc3ccf30d04b292',
      557368064,
    ),
    license: 'Apache-2.0',
    prompt: TRANSCRIBE_PROMPT,
  },
  {
    id: 'gemma-4-e4b',
    label: 'Gemma 4 E4B it (Q4_0)',
    repo: 'ggml-org/gemma-4-E4B-it-GGUF',
    model: file(
      'gemma-4-E4B-it-Q4_0.gguf',
      'a555b900214b477d8880e7832e0b8925e139b0159640036b09fe472b6f2097f2',
      4590807392,
    ),
    mmproj: file(
      'mmproj-gemma-4-E4B-it-Q8_0.gguf',
      '197f49a93027f9843772bd24a6a9e0be2a32a788de5a3def330e9c585d86edd1',
      559874816,
    ),
    license: 'Apache-2.0',
    prompt: TRANSCRIBE_PROMPT,
  },
  {
    id: 'minicpm-v-4.6',
    label: 'MiniCPM-V 4.6 (Q8_0)',
    repo: 'ggml-org/MiniCPM-V-4.6-GGUF',
    model: file(
      'MiniCPM-V-4.6-Q8_0.gguf',
      '9b80dff0d2757bd298a10a1cd39ee8ab577c974826da5c6cef6b86472a45a0c3',
      811591648,
    ),
    mmproj: file(
      'mmproj-MiniCPM-V-4.6-Q8_0.gguf',
      '3d8249cdd0e1cb699644eb021fbcc04320aad89fa5dc9234ef94db0846556581',
      727954528,
    ),
    license: 'Apache-2.0',
    prompt: TRANSCRIBE_PROMPT,
  },
  {
    id: 'glm-ocr',
    label: 'GLM-OCR (Q8_0)',
    repo: 'ggml-org/GLM-OCR-GGUF',
    model: file(
      'GLM-OCR-Q8_0.gguf',
      '45bc244a6446aff850521dc41f18bc8d7105ad5f0c2c8c28af04e7cc4f4d50b1',
      950433408,
    ),
    mmproj: file(
      'mmproj-GLM-OCR-Q8_0.gguf',
      '9c4b58e33e316ed142eb5dcb41abec3844d3e6e5dc361ffb782c3fa9d175141f',
      484403648,
    ),
    license: 'MIT',
    prompt: 'Text Recognition:',
  },
  {
    id: 'paddleocr-vl-1.6',
    label: 'PaddleOCR-VL 1.6 (BF16)',
    repo: 'PaddlePaddle/PaddleOCR-VL-1.6-GGUF',
    model: file(
      'PaddleOCR-VL-1.6-GGUF.gguf',
      'f3ae46ec885050acf4b3d31944431e1fd90d50664fb09126af4a3c050ba14ee8',
      935769056,
    ),
    mmproj: file(
      'PaddleOCR-VL-1.6-GGUF-mmproj.gguf',
      '204d757d7610d9b3faab10d506d69e5b244e32bf765e2bab2d0167e65e0a058a',
      881770560,
    ),
    license: 'Apache-2.0',
    prompt: 'OCR:',
  },
  {
    id: 'lightonocr-2-1b',
    label: 'LightOnOCR-2 1B (Q8_0)',
    repo: 'ggml-org/LightOnOCR-2-1B-GGUF',
    model: file(
      'LightOnOCR-2-1B-Q8_0.gguf',
      'f4cfc0ea9765a4cac22a235191c48aefa94df223419f5ab658b6201f36206d58',
      639443584,
    ),
    mmproj: file(
      'mmproj-LightOnOCR-2-1B-Q8_0.gguf',
      'e9b45eb85b0f0afb3cc138236eec7adb75879420130e5e2049ee9af3f24e337f',
      449452288,
    ),
    license: 'Apache-2.0',
    prompt: null,
  },
  {
    id: 'dots-ocr',
    label: 'dots.ocr (Q8_0)',
    repo: 'ggml-org/dots.ocr-GGUF',
    model: file(
      'dots.ocr-Q8_0.gguf',
      '6f2db1a75215893760b7c7185d52f11715d2e0cb7bff9cefd3f6d409fa1de7e9',
      1894530272,
    ),
    mmproj: file(
      'mmproj-dots.ocr-Q8_0.gguf',
      '20d3d35bea3a64ead0b4b213f8db0de136e174bb5b75b8e85786c51e8e822423',
      1344068512,
    ),
    license: 'MIT',
    prompt: 'Extract the text content from this image.',
  },
];

export function fileUrl(candidate: Candidate, model: ModelFile): string {
  return `https://huggingface.co/${candidate.repo}/resolve/main/${model.name}`;
}
