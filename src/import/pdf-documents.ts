import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFPageProxy,
} from 'pdfjs-dist';
// oxlint-disable-next-line import/default
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

const documents = new Map<string, PDFDocumentLoadingTask>();

export async function openPdf(file: File): Promise<{ documentId: string; pageCount: number }> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({ data });
  const document = await task.promise;
  const documentId = crypto.randomUUID();
  documents.set(documentId, task);
  return { documentId, pageCount: document.numPages };
}

export async function getPdfPage(documentId: string, pageNumber: number): Promise<PDFPageProxy> {
  const task = documents.get(documentId);
  if (task === undefined) throw new Error('PDF-Dokument wurde bereits freigegeben.');
  return (await task.promise).getPage(pageNumber);
}

export async function releasePdf(documentId: string): Promise<void> {
  const task = documents.get(documentId);
  if (task === undefined) return;
  documents.delete(documentId);
  await task.destroy();
}
