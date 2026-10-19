import { openPdf, releasePdf } from './pdf-documents.ts';
import type { ImportPage } from './pages.ts';
import { imageThumbnail, pdfThumbnail } from './thumbnails.ts';

export const ACCEPTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.pdf'] as const;
export const ACCEPT_ATTRIBUTE = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].join(
  ',',
);

export type FileKind = 'image' | 'pdf';

export function detectFileKind(file: Pick<File, 'name' | 'type'>): FileKind | undefined {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    ['.png', '.jpg', '.jpeg', '.webp'].some((extension) => name.endsWith(extension))
  ) {
    return 'image';
  }
  return undefined;
}

export async function loadImage(file: File): Promise<ImportPage[]> {
  const thumbnail = await imageThumbnail(file);
  return [
    {
      id: crypto.randomUUID(),
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
      message: `„${file.name}“ wird nicht unterstützt. Erlaubt sind PNG, JPEG, WebP und PDF.`,
    };
  }
  try {
    return { ok: true, pages: kind === 'pdf' ? await loadPdf(file) : await loadImage(file) };
  } catch {
    return { ok: false, message: `„${file.name}“ konnte nicht gelesen werden.` };
  }
}
