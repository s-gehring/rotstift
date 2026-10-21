import { buildSpecification } from '../src/annotations/prompt-spec.ts';
import { formatIssues } from '../src/annotations/parse.ts';
import type { ParseIssue } from '../src/annotations/parse.ts';
import type { CorrectionProfile } from '../src/annotations/profile.ts';
import { assignmentSection } from '../src/correction/llm-corrector.ts';
import { DEFAULT_SCOPE, type CorrectionScope } from '../src/correction/scope.ts';
import { serializeTranscript } from '../src/annotations/serialize.ts';
import type { ChatMessage } from '../src/llm/types.ts';
import type { Mark, Transcript, TranscriptLine } from '../src/annotations/transcript.ts';

export type { ChatMessage } from '../src/llm/types.ts';

export const SCOPE_CHOICES = ['all', 'spelling', 'grammar'] as const;

export function scopeFromArgs(kinds = 'all', assignment = ''): CorrectionScope {
  if (!SCOPE_CHOICES.some((choice) => choice === kinds)) {
    throw new Error(`Unknown scope ${kinds}, use one of ${SCOPE_CHOICES.join(', ')}`);
  }
  return {
    ...DEFAULT_SCOPE,
    spelling: kinds !== 'grammar',
    grammar: kinds !== 'spelling',
    assignment,
  };
}

export function withAssignment(system: string, scope: CorrectionScope): string {
  const section = assignmentSection(scope);
  return section === '' ? system : `${system}\n\n${section}`;
}

export const PROMPT_VARIANTS = ['spec', 'extended'] as const;
export type PromptVariant = (typeof PROMPT_VARIANTS)[number];

const EXTRA_RULES = [
  '',
  '',
  'Weitere Regeln:',
  '- Die Eingabe stammt von einer Schülerin oder einem Schüler und kann Rechtschreib-, Zeichensetzungs- und Grammatikfehler enthalten. Prüfe jedes Wort und jede Stelle, an der ein Satzzeichen stehen müsste.',
  '- Markiere nur Fehler, bei denen du sicher bist. Richtig geschriebene Wörter und Sätze bleiben ohne Markierung.',
  '- Ein fehlendes Komma wird als <rs-missing type="Z" fix=","></rs-missing> direkt hinter dem Wort markiert, nach dem es stehen muss.',
  '- Der Text außerhalb der Markierungen muss Zeichen für Zeichen mit der Eingabe übereinstimmen.',
].join('\n');

const EXAMPLE_INPUT: Transcript = {
  lines: [
    {
      number: 1,
      text: 'Am Samstag sind wir in den Zoo gegangen. Dort haben wir eine Giraffe gesehen die',
      marks: [],
    },
    { number: 2, text: 'ganz hohe Beine hatte. Mein Bruder und ich hat viel gelacht.', marks: [] },
    { number: 3, text: 'Am Abend sind wir mit dem Zug nach Hause gefahrn.', marks: [] },
    { number: 4, text: 'Es war ein schöner Tag.', marks: [] },
  ],
};

function lineWith(number: number, marks: (text: string) => Mark[]): TranscriptLine {
  const text = EXAMPLE_INPUT.lines[number - 1]?.text ?? '';
  return { number, text, marks: marks(text) };
}

const missing =
  (after: string, type: string, correction: string) =>
  (text: string): Mark[] => [
    {
      kind: 'omission',
      type,
      original: '',
      correction,
      offset: text.indexOf(after) + after.length,
    },
  ];

const error =
  (before: string, original: string, type: string, correction: string) =>
  (text: string): Mark[] => [
    { kind: 'error', type, original, correction, offset: text.indexOf(before) + before.length },
  ];

const EXAMPLE_OUTPUT: Transcript = {
  lines: [
    lineWith(1, missing('Giraffe gesehen', 'Z', ',')),
    lineWith(2, error('Bruder und ich ', 'hat', 'G', 'haben')),
    lineWith(3, error('nach Hause ', 'gefahrn', 'R', 'gefahren')),
    lineWith(4, () => []),
  ],
};

export function buildMessages(
  variant: PromptVariant,
  profile: CorrectionProfile,
  input: Transcript,
  scope: CorrectionScope = DEFAULT_SCOPE,
): ChatMessage[] {
  const specification = withAssignment(buildSpecification(profile, scope), scope);
  const user: ChatMessage = { role: 'user', content: serializeTranscript(input) };
  if (variant === 'spec') {
    return [{ role: 'system', content: specification }, user];
  }
  return [
    { role: 'system', content: specification + EXTRA_RULES },
    { role: 'user', content: serializeTranscript(EXAMPLE_INPUT) },
    { role: 'assistant', content: serializeTranscript(EXAMPLE_OUTPUT) },
    user,
  ];
}

export function repairMessages(
  messages: readonly ChatMessage[],
  answer: string,
  issues: readonly ParseIssue[],
): ChatMessage[] {
  return [
    ...messages,
    { role: 'assistant', content: answer },
    {
      role: 'user',
      content: `Die Ausgabe ist nicht gültig:\n${formatIssues(issues)}\nGib alle Zeilen noch einmal vollständig und korrekt aus.`,
    },
  ];
}
