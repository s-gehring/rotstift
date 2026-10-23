import type { PrivacyWorkPage } from '../privacy/pseudonymizing-corrector.ts';
import type { TextRange } from './review-work.ts';

export interface ChosenRange {
  readonly pageId: string;
  readonly range: TextRange;
  readonly text: string;
}

function lowered(text: string): string | null {
  const lower = text.toLocaleLowerCase('de');
  return lower.length === text.length ? lower : null;
}

export function findText(pages: readonly PrivacyWorkPage[], wanted: string): ChosenRange | null {
  const needle = wanted.trim();
  if (needle === '') return null;
  const lowerNeedle = lowered(needle);
  for (const exact of [true, false]) {
    for (const page of pages) {
      for (const [index, line] of page.lines.entries()) {
        const haystack = exact ? line : lowered(line);
        const search = exact ? needle : lowerNeedle;
        if (haystack === null || search === null) continue;
        const offset = haystack.indexOf(search);
        if (offset < 0) continue;
        return {
          pageId: page.pageId,
          range: { line: index + 1, offset, length: needle.length },
          text: line.slice(offset, offset + needle.length),
        };
      }
    }
  }
  return null;
}

function lineElement(node: Node | null): HTMLElement | null {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  return element?.closest<HTMLElement>('[data-line]') ?? null;
}

function shownText(range: Range): string {
  const fragment = range.cloneContents();
  for (const skipped of fragment.querySelectorAll('[data-skip]')) skipped.remove();
  return fragment.textContent;
}

function textBefore(line: HTMLElement, node: Node, offset: number): number {
  const range = line.ownerDocument.createRange();
  range.setStart(line, 0);
  range.setEnd(node, offset);
  return shownText(range).length;
}

export function selectedRange(container: Element, selection: Selection | null): ChosenRange | null {
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const line = lineElement(range.startContainer);
  if (line === null || line !== lineElement(range.endContainer) || !container.contains(line)) {
    return null;
  }
  const pageId = line.closest<HTMLElement>('[data-page-id]')?.dataset['pageId'];
  const number = Number(line.dataset['line']);
  if (pageId === undefined || !Number.isInteger(number)) return null;
  const start = textBefore(line, range.startContainer, range.startOffset);
  const end = textBefore(line, range.endContainer, range.endOffset);
  if (end <= start) return null;
  const full = line.ownerDocument.createRange();
  full.selectNodeContents(line);
  const text = shownText(full);
  return {
    pageId,
    range: { line: number, offset: start, length: end - start },
    text: text.slice(start, end),
  };
}
