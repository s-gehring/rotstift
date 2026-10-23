// @vitest-environment happy-dom
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { AppProvider } from '../app/app-context.tsx';
import { testAppModel } from '../app/test-app.ts';
import type { Corrector } from '../correction/corrector.ts';
import { DEFAULT_SCOPE } from '../correction/scope.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import { withPseudonymization } from '../privacy/pseudonymizing-corrector.ts';
import { reviewWorks, type ReviewFlow } from '../review/review-flow.ts';
import { setupReview, waitFor } from '../review/test-support.ts';
import { detectWork } from './detect.ts';
import { NOT_FOUND, PrivacyReviewDialog, SENT_NOTE } from './PrivacyReviewDialog.tsx';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Live({ flow, arbeiten }: { readonly flow: ReviewFlow; readonly arbeiten: Arbeit[] }) {
  const state = useSyncExternalStore(flow.subscribe, flow.getState);
  const model = testAppModel({
    importState: { arbeiten },
    privacy: {
      works: state.privacy ?? null,
      open: state.privacy != null,
      add: flow.addIdentifier,
      remove: flow.removeIdentifier,
      release: flow.release,
    },
  });
  return (
    <AppProvider value={model}>
      <PrivacyReviewDialog />
    </AppProvider>
  );
}

async function opened() {
  const sent: string[] = [];
  const cloud: Corrector = {
    correct(lines) {
      sent.push(lines.join('\n'));
      return Promise.resolve({ ok: true, correctedText: lines.join('\n') });
    },
  };
  const harness = setupReview(['a', 'b'], {
    detect: async (pages, context, signal) => {
      const found = await detectWork(pages, context, signal);
      return found.map((page) =>
        page.pageId === 'a'
          ? {
              ...page,
              spans: [
                ...page.spans,
                {
                  kind: 'sensitive',
                  category: 'health',
                  source: 'model',
                  line: 2,
                  offset: 14,
                  length: 8,
                },
              ],
            }
          : page,
      );
    },
  });
  harness.h.transcripts.a = { ok: true, lines: ['Ich bin Lena.', 'Lena hat eine Allergie.'] };
  harness.h.transcripts.b = { ok: true, lines: ['Udo spielt mit Udo.'] };
  harness.flow.setShields({ corrector: (pages) => withPseudonymization(cloud, pages) });
  const [a, b] = harness.pages;
  if (a === undefined || b === undefined) throw new Error('missing pages');
  const arbeiten: Arbeit[] = [
    { id: 'w1', name: 'Lena', pages: [a] },
    { id: 'w2', name: 'Aufsatz 2', pages: [b] },
  ];
  const run = harness.flow.start(harness.pages, DEUTSCH, DEFAULT_SCOPE, reviewWorks(arbeiten));
  await waitFor(() => harness.flow.getState().run?.phase === 'awaiting');
  await act(async () => {
    root.render(<Live flow={harness.flow} arbeiten={arbeiten} />);
    await Promise.resolve();
  });
  return { ...harness, run, sent };
}

function text(): string {
  return container.ownerDocument.querySelector('.privacy-text')?.textContent ?? '';
}

function button(name: string): HTMLButtonElement {
  const found = [...container.ownerDocument.querySelectorAll('button')].find(
    (candidate) =>
      candidate.getAttribute('aria-label') === name || candidate.textContent.trim() === name,
  );
  if (found === undefined) throw new Error(`button ${name} missing`);
  return found;
}

function field(label: string): HTMLInputElement | HTMLSelectElement {
  const labelElement = [...container.ownerDocument.querySelectorAll('label')].find(
    (candidate) => candidate.textContent === label,
  );
  const target = container.ownerDocument.getElementById(labelElement?.htmlFor ?? '');
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
    throw new Error(`field ${label} missing`);
  }
  return target;
}

function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function addPlace(value: string, category = 'person') {
  const input = field('Stelle');
  const select = field('Art');
  await act(async () => {
    if (input instanceof HTMLInputElement) type(input, value);
    select.value = category;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => {
    button('Ergänzen').click();
    await Promise.resolve();
  });
}

describe('PrivacyReviewDialog', () => {
  it('lists the works and shows placeholders and warnings', async () => {
    const { flow, run } = await opened();
    const dialog = container.ownerDocument.querySelector('dialog');
    expect(dialog?.textContent).toContain(SENT_NOTE);
    expect(dialog?.textContent).not.toMatch(/anonym/iu);
    const items = [...container.ownerDocument.querySelectorAll('.privacy-work-item')];
    expect(items.map((item) => item.textContent)).toEqual(['Lenazu prüfen', 'Aufsatz 2zu prüfen']);
    expect(items[0]?.getAttribute('aria-current')).toBe('true');
    expect(text()).toContain('Lena [Person 1]');
    expect(text()).toContain('Allergie Warnung: Gesundheit');
    expect(container.ownerDocument.querySelector('.privacy-sensitive')?.getAttribute('title')).toBe(
      'Sensible Angabe: Gesundheit, wird nicht ersetzt',
    );
    flow.cancel();
    await run;
  });

  it('adds a place that is passed on to every occurrence', async () => {
    const { flow, run } = await opened();
    await act(async () => {
      button('Aufsatz 2zu prüfen').click();
      await Promise.resolve();
    });
    expect(text()).toBe('Seite 1Udo spielt mit Udo.');
    await addPlace('Udo');
    expect(text()).toBe('Seite 1Udo [Person 1] spielt mit Udo [Person 1].');
    expect(field('Stelle').value).toBe('');
    flow.cancel();
    await run;
  });

  it('says when an added place is not in the text', async () => {
    const { flow, run } = await opened();
    await addPlace('Berlin', 'place');
    expect(container.ownerDocument.querySelector('[role="alert"]')?.textContent).toBe(NOT_FOUND);
    flow.cancel();
    await run;
  });

  it('removes an identifier for good', async () => {
    const { flow, run } = await opened();
    await act(async () => {
      button('„Lena“ nicht ersetzen').click();
      await Promise.resolve();
    });
    expect(text()).not.toContain('[Person');
    await addPlace('Allergie', 'number');
    expect(text()).toContain('Allergie [Nummer 1]');
    expect(text()).not.toContain('[Person');
    flow.cancel();
    await run;
  });

  it('takes a text selection as the place to add', async () => {
    const { flow, run } = await opened();
    const line = container.ownerDocument.querySelector('[data-line="2"]');
    const words = line?.firstChild?.nextSibling;
    if (!(words instanceof Text)) throw new Error('text missing');
    const range = container.ownerDocument.createRange();
    range.setStart(words, 5);
    range.setEnd(words, 9);
    const selection = globalThis.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    await act(async () => {
      container.ownerDocument
        .querySelector('.privacy-text')
        ?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await Promise.resolve();
    });
    expect(field('Stelle').value).toBe('eine');
    flow.cancel();
    await run;
  });

  it('releases a work, moves on to the next one and sends it with placeholders', async () => {
    const { flow, run, sent } = await opened();
    await act(async () => {
      button('Freigeben').click();
      await Promise.resolve();
    });
    await waitFor(() => sent.length === 1);
    expect(sent).toEqual(['Ich bin [Person 1].\n[Person 1] hat eine Allergie.']);
    const items = [...container.ownerDocument.querySelectorAll('.privacy-work-item')];
    expect(items.map((item) => item.textContent)).toEqual([
      'Lenafreigegeben',
      'Aufsatz 2zu prüfen',
    ]);
    expect(items[1]?.getAttribute('aria-current')).toBe('true');
    expect(field('Stelle')).toBeDefined();
    await act(async () => {
      button('Freigeben').click();
      await run;
    });
    expect(sent).toHaveLength(2);
    expect(flow.getState().outcome).toBe('finished');
  });
});
