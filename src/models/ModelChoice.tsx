import { formatSize } from './format.ts';
import { DEFAULT_MODEL_ID, modelNote, offeredModels, totalBytes } from './registry.ts';
import type { ModelSetup } from './use-model-setup.ts';

interface Props {
  readonly setup: ModelSetup;
  readonly disabled: boolean;
}

export function ModelChoice({ setup, disabled }: Props) {
  const offered = offeredModels(setup.state.hardware?.totalRamBytes ?? null);
  if (offered.length < 2) return null;
  return (
    <fieldset className="model-choice" disabled={disabled}>
      <legend>Welches Modell soll Wörter zählen?</legend>
      {offered.map((candidate) => {
        const note = modelNote(candidate);
        const ready = setup.state.statuses[candidate.id]?.state === 'ready';
        return (
          <label key={candidate.id}>
            <input
              type="radio"
              name="model-choice"
              checked={candidate.id === setup.model.id}
              onChange={() => void setup.select(candidate.id)}
            />
            <span>
              <strong>{candidate.displayName}</strong>
              {candidate.id === DEFAULT_MODEL_ID && ' (Standard)'}
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
      {disabled && (
        <p className="hint">
          Während Wörter gezählt werden, kann das Modell nicht gewechselt werden.
        </p>
      )}
    </fieldset>
  );
}
