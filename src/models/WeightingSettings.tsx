import { useState } from 'react';
import { CATALOG } from '../annotations/catalog.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';
import { useApp } from '../app/app-context.tsx';
import { formatWeighted, WEIGHT_STEPS, weightOf } from '../stats/weighting.ts';
import { Button } from '../ui/Button.tsx';
import { GradingSettings } from './GradingSettings.tsx';

export function WeightingSettings() {
  const { subject, weighting } = useApp();
  const [chosen, setChosen] = useState<CorrectionProfile>(subject.profile);
  const profile = subject.profiles.find((candidate) => candidate.id === chosen.id) ?? chosen;
  const current = weighting.of(profile);
  const kinds = CATALOG[profile.language].kinds.filter((kind) =>
    profile.allowedTypes.includes(kind.code),
  );
  return (
    <details className="weighting">
      <summary>Gewichtung und Noten</summary>
      <div className="weighting-body">
        <label className="weighting-subject">
          <span className="visually-hidden">Fach</span>
          <select
            value={profile.id}
            onChange={(event) => {
              const next = subject.profiles.find(
                (candidate) => candidate.id === event.target.value,
              );
              if (next !== undefined) setChosen(next);
            }}
          >
            {subject.profiles.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.subject}
              </option>
            ))}
          </select>
        </label>
        <ul className="weighting-kinds">
          {kinds.map((kind) => (
            <li key={kind.code}>
              <span className="weighting-code">{kind.code}</span>
              <span className="weighting-name">{kind.name}</span>
              <select
                aria-label={`Gewicht ${kind.name}`}
                value={weightOf(current, kind.code)}
                onChange={(event) =>
                  weighting.set(profile, {
                    ...current,
                    weights: { ...current.weights, [kind.code]: Number(event.target.value) },
                  })
                }
              >
                {WEIGHT_STEPS.map((step) => (
                  <option key={step} value={step}>
                    {formatWeighted(step)}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        <label className="weighting-repeats">
          <input
            type="checkbox"
            checked={current.repeatsOnce}
            onChange={(event) =>
              weighting.set(profile, { ...current, repeatsOnce: event.target.checked })
            }
          />
          Wiederholungsfehler einmal zählen
        </label>
        <div className="settings-actions">
          <Button
            variant="quiet"
            disabled={weighting.isDefault(profile)}
            onClick={() => weighting.reset(profile)}
          >
            Zurücksetzen
          </Button>
        </div>
        <GradingSettings key={profile.id} profile={profile} />
      </div>
    </details>
  );
}
