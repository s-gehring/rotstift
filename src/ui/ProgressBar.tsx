import { classNames } from './class-names.ts';

export interface ProgressBarProps {
  readonly label: string;
  readonly value: number | null;
  readonly max?: number;
  readonly valueText?: string;
  readonly className?: string;
}

export function ProgressBar({ label, value, max = 1, valueText, className }: ProgressBarProps) {
  const fraction = value === null || max <= 0 ? null : Math.min(1, Math.max(0, value / max));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value ?? undefined}
      aria-valuetext={valueText}
      className={classNames('progress-bar', fraction === null && 'is-indeterminate', className)}
    >
      <div
        className="progress-bar-fill"
        style={fraction === null ? undefined : { width: `${(fraction * 100).toFixed(1)}%` }}
      />
    </div>
  );
}
