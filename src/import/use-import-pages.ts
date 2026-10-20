import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { arbeitenReducer, defaultArbeitName, flattenPages } from './arbeiten.ts';
import { fileKey } from './file-kind.ts';
import { loadFile } from './load-files.ts';
import type { ImportPage } from './pages.ts';
import { releasePdf } from './pdf-documents.ts';
import { releaseRemoved } from './release.ts';

export interface Notice {
  readonly id: number;
  readonly text: string;
}

export function useImportPages() {
  const [arbeiten, dispatch] = useReducer(arbeitenReducer, []);
  const pages = useMemo(() => flattenPages(arbeiten), [arbeiten]);
  const [pending, setPending] = useState(0);
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const previous = useRef<readonly ImportPage[]>([]);
  const current = useRef<readonly ImportPage[]>([]);
  const inFlight = useRef(new Set<string>());
  const nextNoticeId = useRef(0);

  useEffect(() => {
    current.current = pages;
    releaseRemoved(previous.current, pages, {
      revokeUrl: (url) => URL.revokeObjectURL(url),
      releaseDocument: (documentId) => void releasePdf(documentId),
    });
    previous.current = pages;
  }, [pages]);

  const addNotices = useCallback((texts: readonly string[]) => {
    setNotices((existing) => [
      ...existing,
      ...texts.map((text) => ({ id: nextNoticeId.current++, text })),
    ]);
  }, []);

  const addFiles = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return;
      setNotices([]);
      const duplicates: string[] = [];
      const accepted: File[] = [];
      const loaded = new Set(current.current.map((page) => page.fileKey));
      for (const file of files) {
        const key = fileKey(file);
        if (loaded.has(key) || inFlight.current.has(key)) {
          duplicates.push(`„${file.name}“ ist bereits geladen und wurde übersprungen.`);
          continue;
        }
        inFlight.current.add(key);
        accepted.push(file);
      }
      if (duplicates.length > 0) addNotices(duplicates);
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
          } else addNotices([result.message]);
          setPending((count) => count - 1);
        });
      }
    },
    [addNotices],
  );

  return {
    arbeiten,
    pages,
    dispatch,
    addFiles,
    busy: pending > 0,
    notices,
    dismissNotices: () => setNotices([]),
  };
}
