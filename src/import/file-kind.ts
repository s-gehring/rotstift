export type FileKind = 'image' | 'pdf';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

export const ACCEPT_ATTRIBUTE = [...IMAGE_TYPES, 'application/pdf'].join(',');

export function detectFileKind(file: Pick<File, 'name' | 'type'>): FileKind | undefined {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    IMAGE_TYPES.includes(file.type) ||
    IMAGE_EXTENSIONS.some((extension) => name.endsWith(extension))
  ) {
    return 'image';
  }
  return undefined;
}

export function fileKey(file: Pick<File, 'name' | 'size' | 'lastModified'>): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}
