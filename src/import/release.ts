import type { ImportPage } from './pages.ts';

export interface ReleaseTargets {
  readonly revokeUrl: (url: string) => void;
  readonly releaseDocument: (documentId: string) => void;
}

function pdfDocumentIds(pages: readonly ImportPage[]): Set<string> {
  const ids = new Set<string>();
  for (const page of pages) {
    if (page.source.kind === 'pdf') ids.add(page.source.documentId);
  }
  return ids;
}

export function releaseRemoved(
  previous: readonly ImportPage[],
  next: readonly ImportPage[],
  targets: ReleaseTargets,
): void {
  const kept = new Set(next.map((page) => page.id));
  for (const page of previous) {
    if (!kept.has(page.id)) targets.revokeUrl(page.thumbnailUrl);
  }
  const stillUsed = pdfDocumentIds(next);
  for (const documentId of pdfDocumentIds(previous)) {
    if (!stillUsed.has(documentId)) targets.releaseDocument(documentId);
  }
}
