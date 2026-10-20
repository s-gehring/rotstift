import type { CorrectorConfig } from '../src/correction/llm-corrector.ts';

export const OCR_PROMPTS = ['app', 'ocr', 'strict'] as const;
export type OcrPrompt = (typeof OCR_PROMPTS)[number];

const READING_HINT =
  'Der Text stammt aus einer automatischen Handschrifterkennung und kann Lesefehler enthalten. Ersetze ein Wort nie durch eine Buchstabenfolge, die kein deutsches Wort ist. Namen, Fachwörter und Fremdwörter, die du nicht kennst, bleiben unverändert.';

const STRICT_HINT =
  'Korrigiere nur eindeutige Fehler. Wenn du nicht sicher bist, ob etwas ein Fehler ist, bleibt es unverändert.';

export function promptConfig(base: CorrectorConfig, variant: OcrPrompt): CorrectorConfig {
  const hints = { app: [], ocr: [READING_HINT], strict: [READING_HINT, STRICT_HINT] }[variant];
  if (hints.length === 0) return base;
  return { ...base, system: [base.system ?? '', ...hints].filter(Boolean).join('\n') };
}
