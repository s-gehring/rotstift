import { detectFileKind, fileKey } from './file-kind.ts';
import type { ImportPage } from './pages.ts';
import { PasswordProtectedError, openPdf, releasePdf } from './pdf-documents.ts';
import { imageThumbnail, pdfThumbnail } from './thumbnails.ts';

export async function loadImage(file: File): Promise<ImportPage[]> {
  const thumbnail = await imageThumbnail(file);
  return [
    {
      id: crypto.randomUUID(),
      fileKey: fileKey(file),
      label: file.name,
      source: { kind: 'image', file },
      width: thumbnail.width,
      height: thumbnail.height,
      rotation: 0,
      thumbnailUrl: thumbnail.url,
    },
  ];
}

export async function loadPdf(file: File): Promise<ImportPage[]> {
  const { documentId, pageCount } = await openPdf(file);
  const pages: ImportPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const thumbnail = await pdfThumbnail(documentId, pageNumber);
      pages.push({
        id: crypto.randomUUID(),
        fileKey: fileKey(file),
        label: pageCount === 1 ? file.name : `${file.name}, Seite ${pageNumber}`,
        source: { kind: 'pdf', documentId, pageNumber },
        width: thumbnail.width,
        height: thumbnail.height,
        rotation: 0,
        thumbnailUrl: thumbnail.url,
      });
    }
    return pages;
  } catch (error) {
    pages.forEach((page) => URL.revokeObjectURL(page.thumbnailUrl));
    await releasePdf(documentId);
    throw error;
  }
}

export type LoadResult =
  | { readonly ok: true; readonly pages: ImportPage[] }
  | { readonly ok: false; readonly message: string };

export async function loadFile(file: File): Promise<LoadResult> {
  const kind = detectFileKind(file);
  if (kind === undefined) {
    return {
      ok: false,
      message: `„${file.name}“ wird nicht unterstützt.`,
    };
  }
  try {
    return { ok: true, pages: kind === 'pdf' ? await loadPdf(file) : await loadImage(file) };
  } catch (error) {
    const reason =
      error instanceof PasswordProtectedError
        ? 'ist passwortgeschützt'
        : 'konnte nicht gelesen werden';
    return { ok: false, message: `„${file.name}“ ${reason}.` };
  }
}
