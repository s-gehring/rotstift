import { formatSize } from './format.ts';
import { choiceModels, modelNote, totalBytes, type AnyModelInfo } from './registry.ts';
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
  return (
    <fieldset className="model-choice" disabled={disabled || hasRunningJob(setup.state)}>
      <legend className="visually-hidden">Modell</legend>
      {offered.map((candidate) => {
        const note = modelNote(candidate);
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
              <span className="model-choice-size">{formatSize(totalBytes(candidate))}</span>
              {note !== null && (
                <span className="model-choice-note">
                  {note.speed} {note.accuracy}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
