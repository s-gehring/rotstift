import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { defaultArbeitName, flattenPages } from './arbeiten.ts';
import { fileKey } from './file-kind.ts';
import { INITIAL_IMPORT_STATE, importReducer } from './import-state.ts';
import { loadFile } from './load-files.ts';
import type { ImportPage } from './pages.ts';
import { releasePdf } from './pdf-documents.ts';
import { releaseRemoved } from './release.ts';

export const UNDO_WINDOW_MS = 60_000;

export interface ImportPagesOptions {
  readonly onProblem?: (text: string) => void;
}

export function useImportPages({ onProblem }: ImportPagesOptions = {}) {
  const [state, dispatch] = useReducer(importReducer, INITIAL_IMPORT_STATE);
  const { arbeiten, removed } = state;
  const pages = useMemo(() => flattenPages(arbeiten), [arbeiten]);
  const removedPages = useMemo(() => (removed === null ? [] : flattenPages(removed)), [removed]);
  const [pending, setPending] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const previous = useRef<readonly ImportPage[]>([]);
  const current = useRef<readonly ImportPage[]>([]);
  const inFlight = useRef(new Set<string>());
  const outstanding = useRef(0);
  const problems = useRef<string[]>([]);
  const report = useRef(onProblem);

  useEffect(() => {
    report.current = onProblem;
  });

  useEffect(() => {
    current.current = pages;
    const kept = [...pages, ...removedPages];
    releaseRemoved(previous.current, kept, {
      revokeUrl: (url) => URL.revokeObjectURL(url),
      releaseDocument: (documentId) => void releasePdf(documentId),
    });
    previous.current = kept;
  }, [pages, removedPages]);

  useEffect(() => {
    if (removed === null) return undefined;
    const timer = window.setTimeout(() => dispatch({ type: 'expire-undo' }), UNDO_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [removed]);

  const flushProblems = useCallback(() => {
    const [first, ...rest] = problems.current;
    problems.current = [];
    if (first === undefined) return;
    report.current?.(rest.length === 0 ? first : `${rest.length + 1} Dateien nicht geladen.`);
  }, []);

  const addFiles = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return;
      const accepted: File[] = [];
      const loaded = new Set(current.current.map((page) => page.fileKey));
      for (const file of files) {
        const key = fileKey(file);
        if (loaded.has(key) || inFlight.current.has(key)) {
          problems.current.push(`„${file.name}“ ist bereits geladen.`);
          continue;
        }
        inFlight.current.add(key);
        accepted.push(file);
      }
      if (accepted.length === 0) flushProblems();
      outstanding.current += accepted.length;
      setPending((count) => count + accepted.length);
      for (const file of accepted) {
        queue.current = queue.current.then(async () => {
          const result = await loadFile(file);
          inFlight.current.delete(fileKey(file));
          if (result.ok) {
            dispatch({
              type: 'add',
              arbeit: {
                id: crypto.randomUUID(),
                name: defaultArbeitName(file.name),
                pages: result.pages,
              },
            });
          } else problems.current.push(result.message);
          outstanding.current -= 1;
          if (outstanding.current === 0) flushProblems();
          setPending((count) => count - 1);
        });
      }
    },
    [flushProblems],
  );

  const undo = useCallback(() => dispatch({ type: 'undo' }), []);

  return {
    arbeiten,
    pages,
    dispatch,
    addFiles,
    busy: pending > 0,
    undo,
  };
}
