import { formatSize } from './format.ts';
import {
  DEFAULT_CORRECTOR_ID,
  DEFAULT_MODEL_ID,
  choiceModels,
  modelNote,
  totalBytes,
  type AnyModelInfo,
} from './registry.ts';
import { roleText } from './role-text.ts';
import { hasRunningJob } from './setup-state.ts';
import type { ModelSetup } from './use-model-setup.ts';

interface Props {
  readonly setup: ModelSetup<AnyModelInfo>;
  readonly disabled: boolean;
}

export function ModelChoice({ setup, disabled }: Props) {
  const offered = choiceModels(
    setup.state.hardware?.totalRamBytes ?? null,
    setup.model,
    setup.models,
  );
  if (offered.length < 2) return null;
  const jobRunning = hasRunningJob(setup.state);
  const text = roleText(setup.model);
  return (
    <fieldset className="model-choice" disabled={disabled || jobRunning}>
      <legend>{text.choice}</legend>
      {offered.map((candidate) => {
        const note = modelNote(candidate);
        const ready = setup.state.statuses[candidate.id]?.state === 'ready';
        return (
          <label key={candidate.id}>
            <input
              type="radio"
              name={`model-choice-${setup.model.role}`}
              checked={candidate.id === setup.model.id}
              onChange={() => void setup.select(candidate.id)}
            />
            <span>
              <strong>{candidate.displayName}</strong>
              {(candidate.id === DEFAULT_MODEL_ID || candidate.id === DEFAULT_CORRECTOR_ID) &&
                ' (Standard)'}
              {`, ${formatSize(totalBytes(candidate))}`}
              {ready && ', eingerichtet'}
              {note && (
                <>
                  <br />
                  {note.speed} {note.accuracy}
                </>
              )}
            </span>
          </label>
        );
      })}
      {disabled && <p className="hint">{text.choiceLocked}</p>}
      {!disabled && jobRunning && (
        <p className="hint">
          Solange ein Modell geladen, geprüft, importiert oder gelöscht wird, kann das Modell nicht
          gewechselt werden.
        </p>
      )}
    </fieldset>
  );
}
