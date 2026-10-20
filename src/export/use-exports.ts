import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app/app-context.tsx';
import type { Arbeit } from '../import/arbeiten.ts';
import { CSV_FILE_NAME, formatClipboardTable, formatCsv } from '../results/export-table.ts';
import { createPdfInput } from '../results/pdf-input.ts';
import { saveCsv } from '../results/save-csv.ts';
import { saveMessage } from '../results/save-message.ts';
import { buildResults, classTotals } from '../results/summary.ts';
import { createReviewExport, PDF_FOOTER } from '../review/export-input.ts';
import { summarizeArbeit } from '../review/summary.ts';
import type { MenuEntry } from '../ui/Menu.tsx';
import type { SaveOutcome } from './save-file.ts';
import {
  saveClassPdf,
  saveCorrectedPdf,
  saveWordCountPdf,
  type SavePdfOptions,
  type SavePhase,
} from './save-pdf.ts';

export interface ExportJob {
  readonly done: number;
  readonly total: number;
  readonly phase: SavePhase;
}

type JobOptions = Required<Pick<SavePdfOptions, 'signal' | 'onProgress' | 'onPhase'>>;

const ABORTED = 'Das Speichern wurde abgebrochen.';

export function useExports(arbeitId?: string) {
  const { importState, work, toasts, run } = useApp();
  const { arbeiten } = importState;
  const entries = work.count.state.entries;
  const review = work.review.state;
  const [job, setJob] = useState<ExportJob | null>(null);
  const [controller, setController] = useState<AbortController | null>(null);
  const pdfInput = useMemo(() => createPdfInput(), []);
  const exporter = useMemo(() => createReviewExport(), []);
  useEffect(() => (controller === null ? undefined : () => controller.abort()), [controller]);

  const { show } = toasts;
  const report = (outcome: SaveOutcome, extension: 'csv' | 'pdf') => {
    const text = saveMessage(outcome, extension);
    if (text !== null) show(text, { tone: outcome.state === 'saved' ? 'info' : 'error' });
  };

  const runPdf = (start: (options: JobOptions) => Promise<SaveOutcome>) => {
    if (controller !== null) return;
    const next = new AbortController();
    setController(next);
    setJob({ done: 0, total: 0, phase: 'building' });
    void start({
      signal: next.signal,
      onProgress: (done, total) => setJob({ done, total, phase: 'building' }),
      onPhase: (phase) => setJob((current) => (current === null ? current : { ...current, phase })),
    }).then((outcome) => {
      setController(null);
      setJob(null);
      if (next.signal.aborted && outcome.state === 'cancelled') show(ABORTED);
      else report(outcome, 'pdf');
    });
  };

  const results = buildResults(arbeiten, entries);
  const totals = classTotals(results);
  const counted = totals.countedPages > 0;
  const profile = Object.keys(review.pages).length > 0 ? review.profile : null;
  const exportable = (candidate: Arbeit) => {
    if (profile === null) return false;
    const summary = summarizeArbeit(candidate, review, entries);
    return summary.complete && !summary.preview && summary.statistics !== null;
  };
  const blocked = run.running || job !== null;

  const items: MenuEntry[] = [];
  const arbeit = arbeiten.find((candidate) => candidate.id === arbeitId);
  if (arbeit !== undefined) {
    const result = results.find((candidate) => candidate.id === arbeit.id);
    const countedArbeit = result !== undefined && result.rows.some((row) => row.words !== null);
    items.push({
      label: 'Diese Arbeit als PDF',
      icon: 'file',
      disabled: blocked || (profile === null ? !countedArbeit : !exportable(arbeit)),
      onSelect: () => {
        const correctedArbeit =
          profile === null ? null : exporter.correctedArbeit(arbeit, review, entries, profile);
        if (correctedArbeit !== null) {
          runPdf((options) =>
            saveCorrectedPdf(correctedArbeit, {
              ...options,
              encodePage: exporter.encodePage,
              footer: PDF_FOOTER,
            }),
          );
        } else if (result !== undefined) {
          runPdf((options) =>
            saveWordCountPdf(pdfInput.wordCountArbeit(arbeit, result), {
              ...options,
              encodePage: pdfInput.encodePage,
            }),
          );
        }
      },
    });
  }

  items.push(
    {
      label: 'Klassen-PDF',
      icon: 'file',
      disabled: blocked || (profile === null ? !counted : !arbeiten.some(exportable)),
      onSelect: () => {
        if (profile !== null) {
          const included = exporter.classArbeiten(arbeiten, review, entries, profile);
          runPdf((options) =>
            saveClassPdf(included, {
              ...options,
              encodePage: exporter.encodePage,
              footer: PDF_FOOTER,
            }),
          );
          return;
        }
        runPdf((options) =>
          saveClassPdf(
            results.flatMap((entry) => {
              const source = arbeiten.find((candidate) => candidate.id === entry.id);
              return source === undefined || entry.rows.length === 0
                ? []
                : [{ kind: 'wordCount' as const, ...pdfInput.wordCountArbeit(source, entry) }];
            }),
            { ...options, encodePage: pdfInput.encodePage },
          ),
        );
      },
    },
    {
      label: 'Tabelle (CSV)',
      icon: 'table',
      disabled: blocked || !counted,
      onSelect: () => {
        void saveCsv(formatCsv(results), CSV_FILE_NAME).then((outcome) => report(outcome, 'csv'));
      },
    },
    {
      label: 'Tabelle kopieren',
      icon: 'copy',
      disabled: blocked || !counted,
      onSelect: () => {
        navigator.clipboard.writeText(formatClipboardTable(results)).then(
          () => show('Tabelle kopiert.'),
          () => show('Kopieren war nicht möglich.', { tone: 'error' }),
        );
      },
    },
  );

  return {
    items,
    job,
    cancel: () => controller?.abort(),
  };
}
