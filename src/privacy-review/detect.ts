import { detectFirstNames } from '../privacy/first-names.ts';
import { detectNames } from '../privacy/names.ts';
import { detectPatterns } from '../privacy/patterns.ts';
import { propagateSpans } from '../privacy/propagate.ts';
import type { PrivacyWorkPage } from '../privacy/pseudonymizing-corrector.ts';
import { detectRules } from '../privacy/rules.ts';
import type { Detector, DetectorContext, PrivacySpan } from '../privacy/types.ts';

export const DETECTORS: readonly Detector[] = [
  detectRules,
  detectPatterns,
  detectNames,
  detectFirstNames,
];

export interface DetectPage {
  readonly pageId: string;
  readonly lines: readonly string[];
}

export type DetectWork = (
  pages: readonly DetectPage[],
  context: DetectorContext,
  signal: AbortSignal,
) => Promise<PrivacyWorkPage[]>;

function splitByPage(pages: readonly DetectPage[], spans: readonly PrivacySpan[]) {
  let first = 0;
  return pages.map((page): PrivacyWorkPage => {
    const from = first;
    first += page.lines.length;
    return {
      pageId: page.pageId,
      lines: page.lines,
      spans: spans
        .filter((span) => span.line > from && span.line <= first)
        .map((span) => ({ ...span, line: span.line - from })),
    };
  });
}

export function createDetectWork(
  detectors: readonly Detector[] | (() => Promise<readonly Detector[]>) = DETECTORS,
): DetectWork {
  return async (pages, context, signal) => {
    const chosen = typeof detectors === 'function' ? await detectors() : detectors;
    const lines = pages.flatMap((page) => page.lines);
    const spans: PrivacySpan[] = [];
    for (const detector of chosen) {
      signal.throwIfAborted();
      spans.push(...(await detector(lines, context, signal)));
    }
    signal.throwIfAborted();
    const found = splitByPage(pages, spans);
    const propagated = propagateSpans(found);
    return found.map((page, index) => ({ ...page, spans: propagated[index] ?? page.spans }));
  };
}

export const detectWork: DetectWork = createDetectWork();
