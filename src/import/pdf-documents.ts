import {
  PasswordException,
  PDFWorker,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFPageProxy,
} from 'pdfjs-dist';

export class PasswordProtectedError extends Error {
  constructor() {
    super('PDF ist passwortgeschützt.');
    this.name = 'PasswordProtectedError';
  }
}

const documents = new Map<string, PDFDocumentLoadingTask>();
let sharedWorker: PDFWorker | undefined;

function getSharedWorker(): PDFWorker {
  sharedWorker ??= PDFWorker.create({
    port: new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), {
      type: 'module',
    }),
  });
  return sharedWorker;
}

function decoderUrl(): string {
  return new URL('/pdfjs-decoders/', document.baseURI).href;
}

export async function openPdf(file: File): Promise<{ documentId: string; pageCount: number }> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({
    data,
    worker: getSharedWorker(),
    useWasm: false,
    wasmUrl: decoderUrl(),
  });
  try {
    const document = await task.promise;
    const documentId = crypto.randomUUID();
    documents.set(documentId, task);
    return { documentId, pageCount: document.numPages };
  } catch (error) {
    await task.destroy();
    throw error instanceof PasswordException ? new PasswordProtectedError() : error;
  }
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
