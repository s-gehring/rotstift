import { useEffect, useRef, useState } from 'react';
import type { SaveOutcome } from '../export/save-file.ts';
import type { SavePdfOptions, SavePhase } from '../export/save-pdf.ts';
import { saveMessage } from '../results/save-message.ts';

export interface PdfJob {
  readonly scope: string;
  readonly done: number;
  readonly total: number;
  readonly phase: SavePhase;
}

export type PdfRunOptions = Required<Pick<SavePdfOptions, 'signal' | 'onProgress' | 'onPhase'>>;

export interface PdfMessage {
  readonly scope: string;
  readonly text: string;
}

const NOT_SAVED = 'Kein Speicherort gewählt, nichts gespeichert.';
const ABORTED = 'Das Speichern wurde abgebrochen.';

export function usePdfSave() {
  const [job, setJob] = useState<PdfJob | null>(null);
  const [message, setMessage] = useState<PdfMessage | null>(null);
  const abort = useRef<AbortController | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (job !== null) return;
    if (returnFocus.current?.isConnected) returnFocus.current.focus();
    returnFocus.current = null;
  }, [job]);

  const run = (
    scope: string,
    trigger: HTMLElement,
    start: (options: PdfRunOptions) => Promise<SaveOutcome>,
  ) => {
    if (abort.current !== null) return;
    const controller = new AbortController();
    abort.current = controller;
    returnFocus.current = trigger;
    setMessage(null);
    setJob({ scope, done: 0, total: 0, phase: 'building' });
    void start({
      signal: controller.signal,
      onProgress: (done, total) => setJob({ scope, done, total, phase: 'building' }),
      onPhase: (phase) => setJob((current) => (current === null ? current : { ...current, phase })),
    }).then((outcome) => {
      abort.current = null;
      setJob(null);
      const aborted = controller.signal.aborted && outcome.state === 'cancelled';
      const text = aborted ? ABORTED : (saveMessage(outcome, 'pdf') ?? NOT_SAVED);
      setMessage({ scope, text });
    });
  };

  const cancel = () => abort.current?.abort();

  return { job, message, run, cancel };
}

export type PdfSave = ReturnType<typeof usePdfSave>;

export function PdfProgress({
  job,
  onCancel,
}: {
  readonly job: PdfJob;
  readonly onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  if (job.phase === 'saving') return null;
  const text = job.total === 0 ? 'PDF wird vorbereitet …' : `Seite ${job.done} von ${job.total}`;
  return (
    <span className="pdf-progress">
      <progress
        value={job.done}
        max={Math.max(job.total, 1)}
        aria-label="Fortschritt des PDF-Exports"
        aria-valuetext={text}
      />
      <span>{text}</span>
      <button type="button" ref={cancel} onClick={onCancel}>
        Abbrechen
      </button>
    </span>
  );
}

export function PdfControls({
  scope,
  label,
  accessibleLabel,
  pdf,
  blocked,
  onSave,
}: {
  readonly scope: string;
  readonly label: string;
  readonly accessibleLabel: string;
  readonly pdf: PdfSave;
  readonly blocked: string | null;
  readonly onSave: (trigger: HTMLElement) => void;
}) {
  const own = pdf.job?.scope === scope ? pdf.job : null;
  const message = pdf.message?.scope === scope ? pdf.message.text : '';
  return (
    <div className="pdf-controls">
      <button
        type="button"
        aria-label={accessibleLabel}
        disabled={blocked !== null || pdf.job !== null}
        onClick={(event) => onSave(event.currentTarget)}
      >
        {label}
      </button>
      {own !== null && <PdfProgress job={own} onCancel={pdf.cancel} />}
      <span role="status">{own?.phase === 'saving' ? 'Speicherort wählen …' : message}</span>
      {blocked !== null && <span className="hint">{blocked}</span>}
    </div>
  );
}
