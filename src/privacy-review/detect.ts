import { detectNames } from '../privacy/names.ts';
import { propagateSpans } from '../privacy/propagate.ts';
import type { PrivacyWorkPage } from '../privacy/pseudonymizing-corrector.ts';
import { detectRules } from '../privacy/rules.ts';
import type { Detector, DetectorContext, PrivacySpan } from '../privacy/types.ts';

export const DETECTORS: readonly Detector[] = [detectRules, detectNames];

export interface DetectPage {
  readonly pageId: string;
  readonly lines: readonly string[];
}

export type DetectWork = (
  pages: readonly DetectPage[],
  context: DetectorContext,
  signal: AbortSignal,
) => Promise<PrivacyWorkPage[]>;

export function createDetectWork(detectors: readonly Detector[] = DETECTORS): DetectWork {
  return async (pages, context, signal) => {
    const found: PrivacyWorkPage[] = [];
    for (const page of pages) {
      const spans: PrivacySpan[] = [];
      for (const detector of detectors) {
        signal.throwIfAborted();
        spans.push(...(await detector(page.lines, context, signal)));
      }
      found.push({ pageId: page.pageId, lines: page.lines, spans });
    }
    signal.throwIfAborted();
    const propagated = propagateSpans(found);
    return found.map((page, index) => ({ ...page, spans: propagated[index] ?? page.spans }));
  };
}

export const detectWork: DetectWork = createDetectWork();
