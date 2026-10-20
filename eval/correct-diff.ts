import { DEUTSCH } from '../src/annotations/profile.ts';
import type { CorrectionProfile } from '../src/annotations/profile.ts';
import type { Transcript } from '../src/annotations/transcript.ts';
import { deriveMarksDetailed } from '../src/correction/derive.ts';
import {
  numberLines,
  readNumberedLines,
  renderPrompt,
  repairMessages,
} from '../src/correction/llm-corrector.ts';
import type { ChatMessage } from '../src/llm/types.ts';
import type { PromptVariant } from './correct-prompts.ts';

const CHECKLIST =
  'Achte besonders auf: das/dass, fehlende Kommas vor Nebensätzen, Infinitivgruppen und in Aufzählungen, Groß- und Kleinschreibung (Nomen, Satzanfang), Fälle (Akkusativ, Dativ, Genitiv), die Übereinstimmung von Subjekt und Verbform sowie Zeitformen.';

function systemTemplate(variant: PromptVariant): string {
  return [
    'Du korrigierst die Fehler in einer Schülerarbeit. Fach: {subject}.',
    'Die Eingabe besteht aus nummerierten Zeilen. Gib genau dieselben Zeilen mit derselben Nummerierung aus, in denen die Fehler behoben sind: Rechtschreibung (auch Groß- und Kleinschreibung und Getrennt- und Zusammenschreibung), Zeichensetzung (fehlende oder falsche Kommas und andere Satzzeichen) und Grammatik (Fall, Zahl, Artikel, Verbform).',
    ...(variant === 'extended' ? [CHECKLIST] : []),
    'Ändere sonst nichts: keine Umformulierung, keine Stiländerung, keine neuen Sätze. Zeilen ohne Fehler bleiben unverändert. Gib nur die Zeilen aus, ohne Erklärung.',
  ].join('\n');
}

const lineTexts = (input: Transcript) => input.lines.map((line) => line.text);

export function diffMessages(
  profile: CorrectionProfile,
  input: Transcript,
  variant: PromptVariant,
): ChatMessage[] {
  const values = {
    subject: profile.subject,
    language: 'Deutsch',
    text: numberLines(lineTexts(input)),
  };
  return [
    { role: 'system', content: renderPrompt(systemTemplate(variant), values) },
    { role: 'user', content: renderPrompt('{text}', values) },
  ];
}

export { repairMessages as diffRepairMessages };

export function diffAnswer(input: Transcript, answer: string) {
  const lines = lineTexts(input);
  const { correctedText, issues } = readNumberedLines(lines, answer);
  const derived = deriveMarksDetailed(lines, correctedText, { profile: DEUTSCH });
  return {
    transcript: { lines: derived.lines.map((line, index) => ({ ...line, number: index + 1 })) },
    issues,
    collapsed: derived.collapsedRuns,
  };
}
