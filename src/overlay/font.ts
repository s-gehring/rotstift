import './overlay.css';
import { FONT_FAMILY, FONT_WEIGHT } from './model.ts';

export function overlayFontSpec(size: number): string {
  return `${FONT_WEIGHT} ${size}px "${FONT_FAMILY}"`;
}

export async function ensureOverlayFont(): Promise<void> {
  if (typeof document === 'undefined') return;
  await document.fonts.load(overlayFontSpec(32), 'ÄÖÜäöüß');
}
