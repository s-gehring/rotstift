import { useMemo } from 'react';
import { useApp } from '../app/app-context.tsx';
import type { Arbeit } from '../import/arbeiten.ts';
import {
  csvFileName,
  formatClipboardTable,
  formatCsv,
  type CorrectionColumns,
} from '../results/export-table.ts';
import { createPdfInput } from '../results/pdf-input.ts';
import { saveCsv } from '../results/save-csv.ts';
import { saveMessage } from '../results/save-message.ts';
import { buildResults, classTotals, type ArbeitResult } from '../results/summary.ts';
import { createReviewExport, PDF_FOOTER } from '../review/export-input.ts';
import { summarizeArbeit } from '../review/summary.ts';
import type { MenuAction } from '../ui/Menu.tsx';
import { beginExport, cancelExport, endExport, useExportBusy } from './export-job.ts';
import { canSaveFiles, type SaveOutcome } from './save-file.ts';
import {
  saveClassPdf,
  saveCorrectedPdf,
  saveWordCountPdf,
  type SavePdfOptions,
} from './save-pdf.ts';

type JobOptions = Required<Pick<SavePdfOptions, 'signal' | 'onProgress' | 'onPhase'>>;

export const EXPORT_HINT = {
  busy: 'Ein Export läuft gerade',
  running: 'Erst nach dem Lauf möglich',
  desktop: 'Nur in der Rotstift-App',
  notCounted: 'Noch nichts gezählt',
  arbeitNotCounted: 'Diese Arbeit ist noch nicht gezählt',
  incomplete: 'Noch nicht alle Seiten korrigiert',
  noneComplete: 'Noch keine Arbeit vollständig korrigiert',
  preview: 'Nicht mit Demo-Korrekturen',
} as const;

const TOAST_KEY = 'export';
const ABORTED = 'Export abgebrochen.';
const COPIED = 'Tabelle kopiert.';
const COPY_FAILED = 'Kopieren war nicht möglich.';

export function progressText(done: number, total: number): string {
  return total === 0 ? 'PDF wird vorbereitet …' : `PDF wird erstellt: Seite ${done} von ${total}`;
}

function firstHint(...hints: readonly (string | false)[]): string | null {
  return hints.find((hint): hint is string => hint !== false) ?? null;
}

function action(
  label: string,
  icon: MenuAction['icon'],
  hint: string | null,
  onSelect: () => void,
): MenuAction {
  return {
    label,
    ...(icon !== undefined && { icon }),
    onSelect,
    ...(hint !== null && { disabled: true, hint }),
  };
}

export function useExports(arbeitId?: string): MenuAction[] {
  const { importState, work, toasts, run, weighting } = useApp();
  const { arbeiten } = importState;
  const entries = work.count.state.entries;
  const review = work.review.state;
  const busy = useExportBusy();
  const pdfInput = useMemo(() => createPdfInput(), []);
  const exporter = useMemo(() => createReviewExport(), []);
  const { show, dismiss } = toasts;

  const report = (outcome: SaveOutcome, extension: 'csv' | 'pdf') => {
    const text = saveMessage(outcome, extension);
    if (text === null) dismiss();
    else show(text, { tone: outcome.state === 'saved' ? 'info' : 'error' });
  };

  const progress = (done: number, total: number) =>
    show(progressText(done, total), {
      key: TOAST_KEY,
      progress: { value: total === 0 ? null : done, max: Math.max(total, 1) },
      action: { label: 'Abbrechen', onAction: cancelExport },
    });

  const runPdf = (start: (options: JobOptions) => Promise<SaveOutcome>) => {
    const job = beginExport();
    if (job === null) return;
    progress(0, 0);
    void start({
      signal: job.signal,
      onProgress: progress,
      onPhase: (phase) => {
        if (phase === 'saving') dismiss();
      },
    }).then((outcome) => {
      endExport(job);
      if (job.signal.aborted && outcome.state === 'cancelled') show(ABORTED);
      else report(outcome, 'pdf');
    });
  };

  const results = buildResults(arbeiten, entries);
  const counted = classTotals(results).countedPages > 0;
  const profile = Object.keys(review.pages).length > 0 ? review.profile : null;
  const summaries = arbeiten.map((candidate) => summarizeArbeit(candidate, review, entries));
  const exportable = summaries.filter(
    (summary) => summary.complete && !summary.preview && summary.statistics !== null,
  );
  const corrections: CorrectionColumns | undefined =
    profile === null
      ? undefined
      : {
          types: profile.allowedTypes,
          arbeiten: summaries,
          profile,
          weighting: weighting.of(profile),
        };
  const blocked = firstHint(busy && EXPORT_HINT.busy, run.running && EXPORT_HINT.running);
  const fileBlocked = blocked ?? (canSaveFiles() ? null : EXPORT_HINT.desktop);

  const arbeitItem = (target: Arbeit, result: ArbeitResult | undefined): MenuAction => {
    const summary = summarizeArbeit(target, review, entries);
    const countedArbeit = result !== undefined && result.rows.some((row) => row.words !== null);
    const hint =
      fileBlocked ??
      (profile === null
        ? firstHint(!countedArbeit && EXPORT_HINT.arbeitNotCounted)
        : firstHint(
            summary.preview && EXPORT_HINT.preview,
            (!summary.complete || summary.statistics === null) && EXPORT_HINT.incomplete,
          ));
    return action('Diese Arbeit als PDF', 'file', hint, () => {
      const corrected =
        profile === null ? null : exporter.correctedArbeit(target, review, entries, profile);
      if (corrected !== null) {
        runPdf((options) =>
          saveCorrectedPdf(corrected, {
            ...options,
            encodePage: exporter.encodePage,
            footer: PDF_FOOTER,
          }),
        );
      } else if (result !== undefined) {
        runPdf((options) =>
          saveWordCountPdf(pdfInput.wordCountArbeit(target, result), {
            ...options,
            encodePage: pdfInput.encodePage,
          }),
        );
      }
    });
  };

  const items: MenuAction[] = [];
  const arbeit = arbeiten.find((candidate) => candidate.id === arbeitId);
  if (arbeit !== undefined) {
    items.push(
      arbeitItem(
        arbeit,
        results.find((candidate) => candidate.id === arbeit.id),
      ),
    );
  }

  const tableHint = counted ? null : EXPORT_HINT.notCounted;
  let classHint: string | null = tableHint;
  if (profile !== null && exportable.length === 0) {
    classHint = summaries.some((summary) => summary.preview)
      ? EXPORT_HINT.preview
      : EXPORT_HINT.noneComplete;
  } else if (profile !== null) {
    classHint = null;
  }

  items.push(
    action('Klassen-PDF', 'file', fileBlocked ?? classHint, () => {
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
    }),
    action('Tabelle (CSV)', 'table', fileBlocked ?? tableHint, () => {
      void saveCsv(formatCsv(results, corrections), csvFileName(corrections)).then((outcome) =>
        report(outcome, 'csv'),
      );
    }),
    action('Tabelle kopieren', 'copy', blocked ?? tableHint, () => {
      navigator.clipboard.writeText(formatClipboardTable(results, corrections)).then(
        () => show(COPIED),
        () => show(COPY_FAILED, { tone: 'error' }),
      );
    }),
  );

  return items;
}
