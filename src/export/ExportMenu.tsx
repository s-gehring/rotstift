import { useEffect, useRef } from 'react';
import { IconButton } from '../ui/IconButton.tsx';
import { Menu } from '../ui/Menu.tsx';
import { ProgressBar } from '../ui/ProgressBar.tsx';
import { useExports } from './use-exports.ts';

export interface ExportMenuProps {
  readonly arbeitId?: string;
  readonly variant?: 'primary' | 'secondary';
}

export function ExportMenu({ arbeitId, variant = 'primary' }: ExportMenuProps) {
  const exports = useExports(arbeitId);
  const { job } = exports;
  const root = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const running = job !== null;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running) cancel.current?.focus();
    else if (wasRunning.current && document.activeElement === document.body) {
      root.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
    }
    wasRunning.current = running;
  }, [running]);
  const text =
    job === null
      ? ''
      : job.phase === 'saving'
        ? 'Speicherort wählen …'
        : job.total === 0
          ? 'PDF wird vorbereitet …'
          : `Seite ${job.done} von ${job.total}`;
  return (
    <div className="export-menu" ref={root}>
      {job !== null && (
        <div className="export-progress">
          <span className="export-progress-text" role="status">
            {text}
          </span>
          <ProgressBar
            label="Fortschritt des PDF-Exports"
            value={job.total === 0 ? null : job.done}
            max={Math.max(job.total, 1)}
            valueText={text}
          />
          <IconButton
            ref={cancel}
            label="Export abbrechen"
            icon="close"
            disabled={job.phase === 'saving'}
            onClick={exports.cancel}
          />
        </div>
      )}
      <Menu label="Exportieren" items={exports.items} variant={variant} disabled={running}>
        Exportieren
      </Menu>
    </div>
  );
}
