// @vitest-environment happy-dom
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flattenPages, type Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import { createRunner, type Runner } from '../pipeline/runner.ts';
import type {
  PageTranscriber,
  TranscribeResult,
  TranscriberStatus,
} from '../pipeline/transcriber.ts';
import { ResultsView } from './ResultsView.tsx';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function page(id: string): ImportPage {
  return {
    id,
    fileKey: id,
    label: `${id}.png`,
    source: { kind: 'image', file: new File([], `${id}.png`) },
    width: 10,
    height: 10,
    rotation: 0,
    thumbnailUrl: `blob:${id}`,
  };
}

const initialPages = [page('a'), page('b')];

function arbeit(id: string, name: string, pages: readonly ImportPage[]): Arbeit {
  return { id, name, pages };
}

const initialArbeiten = [arbeit('x', 'Aufsatz', initialPages)];

const transcriber: PageTranscriber = {
  transcribe: () => Promise.resolve({ ok: true, lines: ['eins zwei drei'] }),
};

const ready: TranscriberStatus = { state: 'ready', transcriber, demo: false };

const failure = { ok: false, error: { kind: 'failed', message: 'x' } } as const;

function App({
  runner,
  canRetry = true,
  arbeiten,
  locked = false,
}: {
  runner: Runner;
  canRetry?: boolean;
  arbeiten: readonly Arbeit[];
  locked?: boolean;
}) {
  const state = useSyncExternalStore(runner.subscribe, runner.getState);
  return (
    <ResultsView
      arbeiten={arbeiten}
      count={{ runner, state }}
      canRetry={canRetry}
      locked={locked}
    />
  );
}

let container: HTMLElement;
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

function show(runner: Runner, arbeiten: readonly Arbeit[], canRetry = true) {
  runner.setPages(flattenPages(arbeiten));
  act(() => root.render(<App runner={runner} arbeiten={arbeiten} canRetry={canRetry} />));
}

function mount(status: TranscriberStatus, arbeiten: readonly Arbeit[] = initialArbeiten) {
  const runner = createRunner({ render: () => Promise.resolve(new Blob()) });
  runner.setTranscriber(status.state === 'ready' ? status.transcriber : null);
  show(runner, arbeiten);
  return runner;
}

const button = (label: string) =>
  [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === label);

function textarea(): HTMLTextAreaElement {
  const found = container.querySelector('textarea');
  if (found === null) throw new Error('Kein Transkript vorhanden');
  return found;
}

function type(field: HTMLTextAreaElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  act(() => {
    descriptor?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function countWords(runner: Runner) {
  await act(async () => {
    runner.start();
    await vi.waitFor(() => expect(runner.getState().batch).toBeNull());
  });
}

const text = (testId: string) =>
  [...container.querySelectorAll(`[data-testid=${testId}]`)].map((node) => node.textContent);

const sequence = (): TranscriberStatus => ({
  state: 'ready',
  demo: false,
  transcriber: {
    transcribe: (() => {
      const texts = [['eins zwei'], ['drei vier fünf'], ['sechs']];
      let call = 0;
      return () => Promise.resolve({ ok: true, lines: texts[call++] ?? [] } as TranscribeResult);
    })(),
  },
});

describe('before anything is counted', () => {
  it('renders no results', () => {
    mount(ready);
    expect(container.querySelector('.results')).toBeNull();
  });
});

describe('with a transcriber', () => {
  it('counts words and keeps the page words and the total in sync with edits', async () => {
    const runner = mount(ready);
    await countWords(runner);

    expect(text('page-words')).toEqual(['3 Wörter', '3 Wörter']);
    expect(text('arbeit-words')).toEqual(['6 Wörter']);
    expect(text('total-words')[0]).toContain('6');

    type(textarea(), 'eins zwei drei vier fünf');
    expect(text('page-words')).toEqual(['5 Wörter', '3 Wörter']);
    expect(text('arbeit-words')).toEqual(['8 Wörter']);
    expect(text('total-words')[0]).toContain('8');
  });

  it('locks editing and retrying while a review runs', async () => {
    const runner = mount(ready);
    await countWords(runner);
    expect(textarea().closest('fieldset')?.disabled).toBe(false);

    act(() => root.render(<App runner={runner} arbeiten={initialArbeiten} locked />));
    const lock = textarea().closest('fieldset');
    expect(lock?.disabled).toBe(true);
    expect(container.querySelector('.results')?.contains(lock ?? null)).toBe(true);

    act(() => root.render(<App runner={runner} arbeiten={initialArbeiten} />));
    expect(textarea().closest('fieldset')?.disabled).toBe(false);
  });

  it('asks before an edited transcript is replaced', async () => {
    const runner = mount(ready);
    await countWords(runner);
    type(textarea(), 'von Hand');

    const rotated = [arbeit('x', 'Aufsatz', [{ ...page('a'), rotation: 90 as const }, page('b')])];
    show(runner, rotated);
    expect(container.textContent).toContain('Die Seite wurde nach der Erkennung gedreht.');

    act(() => button('Neu erkennen')?.click());
    expect(container.textContent).toContain('Ihre Änderungen an Seite 1 gehen verloren.');
    act(() => button('Änderungen behalten')?.click());
    expect(container.textContent).not.toContain('gehen verloren');
    expect(textarea().value).toBe('von Hand');

    act(() => button('Neu erkennen')?.click());
    await act(async () => {
      button('Trotzdem neu erkennen')?.click();
      await vi.waitFor(() => expect(runner.getState().batch).toBeNull());
    });
    expect(textarea().value).toBe('eins zwei drei');
    expect(container.textContent).not.toContain('gehen verloren');
  });

  it('retries an unedited rotated page without asking', async () => {
    const runner = mount(ready);
    await countWords(runner);

    const rotated = [arbeit('x', 'Aufsatz', [{ ...page('a'), rotation: 90 as const }, page('b')])];
    show(runner, rotated);
    await act(async () => {
      button('Neu erkennen')?.click();
      await vi.waitFor(() => expect(runner.getState().batch).toBeNull());
    });
    expect(container.textContent).not.toContain('gehen verloren');
    expect(button('Neu erkennen')).toBeUndefined();
    expect(text('page-words')).toEqual(['3 Wörter', '3 Wörter']);
  });

  it('offers a retry for pages that could not be recognised without raising an alert', async () => {
    const runner = mount({
      state: 'ready',
      demo: false,
      transcriber: { transcribe: () => Promise.resolve(failure) },
    });
    await countWords(runner);
    expect(container.querySelector('[role=alert]')).toBeNull();
    expect(container.querySelectorAll('.error-text')).toHaveLength(2);
    expect(
      [...container.querySelectorAll('button')].filter(
        (candidate) => candidate.textContent === 'Erneut versuchen',
      ),
    ).toHaveLength(2);
  });

  it('counts a page after a successful retry', async () => {
    let call = 0;
    const flaky: TranscriberStatus = {
      state: 'ready',
      demo: false,
      transcriber: {
        transcribe: () =>
          Promise.resolve(call++ === 0 ? failure : { ok: true, lines: ['eins zwei'] }),
      },
    };
    const runner = mount(flaky);
    await countWords(runner);
    expect(text('page-words')).toEqual(['2 Wörter']);
    expect(text('arbeit-words')).toEqual(['2 Wörter']);
    expect(container.textContent).toContain('(aus 1 von 2 Seiten)');

    await act(async () => {
      button('Erneut versuchen')?.click();
      await vi.waitFor(() => expect(runner.getState().batch).toBeNull());
    });
    expect(text('page-words')).toEqual(['2 Wörter', '2 Wörter']);
    expect(text('arbeit-words')).toEqual(['4 Wörter']);
    expect(container.textContent).not.toContain('Seiten)');
    expect(button('Erneut versuchen')).toBeUndefined();
  });

  it('disables the retry button when retrying is not possible', async () => {
    const runner = mount({
      state: 'ready',
      demo: false,
      transcriber: { transcribe: () => Promise.resolve(failure) },
    });
    await countWords(runner);
    expect(button('Erneut versuchen')?.disabled).toBe(false);

    act(() => root.render(<App runner={runner} arbeiten={initialArbeiten} canRetry={false} />));
    expect(button('Erneut versuchen')?.disabled).toBe(true);
  });

  it('shows a neutral hint for a page without any writing', async () => {
    const blank: TranscriberStatus = {
      state: 'ready',
      demo: false,
      transcriber: { transcribe: () => Promise.resolve({ ok: true, lines: [] }) },
    };
    const runner = mount(blank);
    await countWords(runner);
    expect(container.textContent).toContain('Keine Schrift erkannt');
    expect(container.querySelector('.error-text')).toBeNull();
    expect(text('total-words')[0]).toContain('0 Wörter');
  });

  it('does not show the blank hint for pages with text', async () => {
    const runner = mount(ready);
    await countWords(runner);
    expect(container.textContent).not.toContain('Keine Schrift erkannt');
  });
});

describe('a class with several Arbeiten', () => {
  const klasse = [
    arbeit('anna', 'Anna', [page('a1'), page('a2')]),
    arbeit('ben', 'Ben', [page('b1')]),
  ];

  it('shows the words per Arbeit, the class total and the average', async () => {
    const runner = mount(sequence(), klasse);
    await countWords(runner);
    expect(text('arbeit-words')).toEqual(['5 Wörter', '1 Wort']);
    expect(text('total-words')[0]).toContain('6');
    expect(text('average-words')[0]).toContain('2 Arbeiten');
    expect(text('average-words')[0]).toContain('Durchschnitt 3 Wörter pro Arbeit');
    expect([...container.querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual([
      'Anna',
      'Ben',
    ]);
  });

  it('updates the Arbeit words, the total and the average when a transcript is edited', async () => {
    const runner = mount(sequence(), klasse);
    await countWords(runner);

    const field = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Transkript von Seite 1 (Ben)"]',
    );
    if (field === null) throw new Error('Kein Transkript vorhanden');
    type(field, 'a b c d e f g');

    expect(text('arbeit-words')).toEqual(['5 Wörter', '7 Wörter']);
    expect(text('total-words')[0]).toContain('12');
    expect(text('average-words')[0]).toContain('Durchschnitt 6 Wörter pro Arbeit');
  });

  it('marks partial counts per Arbeit, in total and for the average', async () => {
    let call = 0;
    const partial: TranscriberStatus = {
      state: 'ready',
      demo: false,
      transcriber: {
        transcribe: () => {
          const current = call++;
          return Promise.resolve(current === 1 ? failure : { ok: true, lines: ['eins zwei'] });
        },
      },
    };
    const runner = mount(partial, klasse);
    await countWords(runner);

    const sections = [...container.querySelectorAll('.arbeit-result')];
    expect(sections[0]?.textContent).toContain('(aus 1 von 2 Seiten)');
    expect(sections[1]?.textContent).not.toContain('Seiten)');
    expect(text('total-words')[0]).toContain('(aus 2 von 3 Seiten)');
    expect(text('average-words')[0]).toContain('(aus 1 von 2 Arbeiten)');
  });

  it('shows Arbeiten without any counted page as not counted', async () => {
    const runner = mount(
      {
        state: 'ready',
        demo: false,
        transcriber: { transcribe: () => Promise.resolve(failure) },
      },
      klasse,
    );
    await countWords(runner);
    expect(text('arbeit-words')).toEqual(['Nicht gezählt', 'Nicht gezählt']);
    expect(text('total-words')[0]).toContain('0 Wörter');
  });
});
