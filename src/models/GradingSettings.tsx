import { useState } from 'react';
import type { CorrectionProfile } from '../annotations/profile.ts';
import { useApp } from '../app/app-context.tsx';
import {
  formatLimit,
  GRADES,
  gradeColumn,
  misorderedLimits,
  parseLimit,
  type GradeScale,
} from '../stats/grading.ts';
import { Segmented } from '../ui/Segmented.tsx';

const SCALE_OPTIONS = [
  { value: 'grades', label: 'Noten 1–6' },
  { value: 'points', label: 'Punkte 15–0' },
] as const;

function LimitInput({
  label,
  value,
  misordered,
  onChange,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly misordered: boolean;
  readonly onChange: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(() => formatLimit(value));
  const parsed = parseLimit(draft);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={parsed === undefined || misordered}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        const next = parseLimit(event.target.value);
        if (next !== undefined) onChange(next);
      }}
      onBlur={() => {
        if (parsed !== undefined) setDraft(formatLimit(parsed));
      }}
    />
  );
}

export function GradingSettings({ profile }: { readonly profile: CorrectionProfile }) {
  const { grading } = useApp();
  const current = grading.of(profile);
  const { scale } = current;
  const limits = current.limits[scale];
  const misordered = misorderedLimits(limits);
  const grades = GRADES[scale];
  const column = gradeColumn(scale);
  return (
    <div className="grading">
      <label className="weighting-repeats">
        <input
          type="checkbox"
          checked={current.enabled}
          onChange={(event) => grading.set(profile, { ...current, enabled: event.target.checked })}
        />
        Notenschwellen
      </label>
      {current.enabled && (
        <>
          <Segmented<GradeScale>
            label="Notenskala"
            options={SCALE_OPTIONS}
            value={scale}
            onChange={(next) => grading.set(profile, { ...current, scale: next })}
          />
          <table className="grading-table">
            <thead>
              <tr>
                <th scope="col">{column}</th>
                <th scope="col">Fehlerquotient bis</th>
              </tr>
            </thead>
            <tbody>
              {grades.map((grade, index) => (
                <tr key={`${scale}-${grade}`}>
                  <th scope="row">{grade}</th>
                  <td>
                    {index < limits.length ? (
                      <LimitInput
                        label={`${column} ${grade} bis`}
                        value={limits[index] ?? null}
                        misordered={misordered.has(index)}
                        onChange={(value) =>
                          grading.set(profile, {
                            ...current,
                            limits: {
                              ...current.limits,
                              [scale]: limits.map((limit, at) => (at === index ? value : limit)),
                            },
                          })
                        }
                      />
                    ) : (
                      <span className="grading-rest">darüber</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
