import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { loadFile } from './load-files.ts';
import { pagesReducer, type ImportPage } from './pages.ts';
import { releasePdf } from './pdf-documents.ts';

function pdfDocumentIds(pages: readonly ImportPage[]): Set<string> {
  const ids = new Set<string>();
  for (const page of pages) {
    if (page.source.kind === 'pdf') ids.add(page.source.documentId);
  }
  return ids;
}

export function useImportPages() {
  const [pages, dispatch] = useReducer(pagesReducer, []);
  const [pending, setPending] = useState(0);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const previous = useRef<readonly ImportPage[]>([]);

  useEffect(() => {
    const kept = new Set(pages.map((page) => page.id));
    for (const page of previous.current) {
      if (!kept.has(page.id)) URL.revokeObjectURL(page.thumbnailUrl);
    }
    const stillUsed = pdfDocumentIds(pages);
    for (const documentId of pdfDocumentIds(previous.current)) {
      if (!stillUsed.has(documentId)) void releasePdf(documentId);
    }
    previous.current = pages;
  }, [pages]);

  const addFiles = useCallback((files: readonly File[]) => {
    if (files.length === 0) return;
    setErrors([]);
    setPending((count) => count + files.length);
    for (const file of files) {
      queue.current = queue.current.then(async () => {
        const result = await loadFile(file);
        if (result.ok) dispatch({ type: 'add', pages: result.pages });
        else setErrors((current) => [...current, result.message]);
        setPending((count) => count - 1);
      });
    }
  }, []);

  return {
    pages,
    dispatch,
    addFiles,
    busy: pending > 0,
    errors,
    dismissErrors: () => setErrors([]),
  };
}
