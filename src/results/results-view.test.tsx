// @vitest-environment happy-dom
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportPage } from '../import/pages.ts';
import { createRunner, type Runner } from '../pipeline/runner.ts';
import type {
  PageTranscriber,
  TranscribeResult,
  TranscriberStatus,
} from '../pipeline/transcriber.ts';
import { CountControls, CountHint } from './CountControls.tsx';
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

const transcriber: PageTranscriber = {
  transcribe: () => Promise.resolve({ ok: true, lines: ['eins zwei drei'] }),
};

const ready: TranscriberStatus = { state: 'ready', transcriber, demo: false };

function App({
  runner,
  status,
  pages,
}: {
  runner: Runner;
  status: TranscriberStatus | null;
  pages: readonly ImportPage[];
}) {
  const state = useSyncExternalStore(runner.subscribe, runner.getState);
  const count = { runner, state };
  return (
    <>
      <CountControls count={count} status={status} pages={pages} />
      <CountHint count={count} status={status} pages={pages} />
      <ResultsView pages={pages} count={count} canRetry={status?.state === 'ready'} />
    </>
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

function show(runner: Runner, status: TranscriberStatus | null, pages: readonly ImportPage[]) {
  runner.setPages(pages);
  act(() => root.render(<App runner={runner} status={status} pages={pages} />));
}

function mount(status: TranscriberStatus | null) {
  const runner = createRunner({ render: () => Promise.resolve(new Blob()) });
  runner.setTranscriber(status?.state === 'ready' ? status.transcriber : null);
  show(runner, status, initialPages);
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

describe('without a transcriber', () => {
  it('keeps the button disabled and says why', () => {
    mount({
      state: 'unavailable',
      message: 'Die Texterkennung ist auf diesem Rechner noch nicht eingerichtet.',
    });
    expect(button('Wörter zählen')?.disabled).toBe(true);
    expect(container.querySelector('#count-hint')?.textContent).toContain(
      'noch nicht eingerichtet',
    );
    expect(container.querySelector('.results')).toBeNull();
  });

  it('shows a hint while the availability is being checked', () => {
    mount(null);
    expect(button('Wörter zählen')?.disabled).toBe(true);
    expect(container.querySelector('#count-hint')?.textContent).toContain('wird geprüft');
  });
});

describe('with a missing model', () => {
  it('disables counting and offers the setup instead', () => {
    const runner = createRunner({ render: () => Promise.resolve(new Blob()) });
    const onSetup = vi.fn<() => void>();
    runner.setPages(initialPages);
    const status: TranscriberStatus = { state: 'needs-model', problem: 'missing' };
    act(() =>
      root.render(
        <CountControls
          count={{ runner, state: runner.getState() }}
          status={status}
          pages={initialPages}
          onSetup={onSetup}
        />,
      ),
    );
    expect(button('Wörter zählen')?.disabled).toBe(true);
    act(() => button('Texterkennung einrichten')?.click());
    expect(onSetup).toHaveBeenCalledOnce();
  });

  it('explains the situation in German while the model downloads', () => {
    const runner = createRunner({ render: () => Promise.resolve(new Blob()) });
    const count = { runner, state: runner.getState() };
    const download = {
      modelId: 'm',
      state: 'downloading',
      downloadedBytes: 412_000_000,
      totalBytes: 1_552_000_000,
    } as const;
    act(() =>
      root.render(
        <CountHint
          count={count}
          status={{ state: 'needs-model', problem: 'downloading' }}
          pages={initialPages}
          download={download}
        />,
      ),
    );
    expect(container.textContent).toContain('412 MB von 1.552 MB');
  });
});

function deferred<T>() {
  const handle: { resolve: (value: T) => void } = { resolve: () => undefined };
  const promise = new Promise<T>((resolve) => {
    handle.resolve = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      handle.resolve(value);
    },
  };
}

describe('with a transcriber that is starting', () => {
  it('shows that the recognition starts before the first page', async () => {
    let phase: 'idle' | 'starting' | 'ready' = 'starting';
    const listeners = new Set<() => void>();
    const engine = {
      getPhase: () => phase,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    };
    const pending = deferred<TranscribeResult>();
    const slow: PageTranscriber = { transcribe: () => pending.promise };
    const runner = mount({ state: 'ready', transcriber: slow, demo: false, engine });
    act(() => runner.start());
    expect(container.querySelector('.progress')?.textContent).toBe('Texterkennung startet …');
    act(() => {
      phase = 'ready';
      for (const listener of listeners) listener();
    });
    expect(container.querySelector('.progress')?.textContent).toContain('Seite 1 von 2');
    await act(async () => {
      pending.resolve({ ok: true, lines: ['eins'] });
      await Promise.resolve();
    });
  });
});

describe('with a transcriber', () => {
  it('counts words and keeps the page words and the total in sync with edits', async () => {
    const runner = mount(ready);
    expect(button('Wörter zählen')?.disabled).toBe(false);
    await countWords(runner);

    const words = () =>
      [...container.querySelectorAll('[data-testid=page-words]')].map((node) => node.textContent);
    expect(words()).toEqual(['3 Wörter', '3 Wörter']);
    expect(container.querySelector('[data-testid=total-words]')?.textContent).toContain('6');

    type(textarea(), 'eins zwei drei vier fünf');
    expect(words()).toEqual(['5 Wörter', '3 Wörter']);
    expect(container.querySelector('[data-testid=total-words]')?.textContent).toContain('8');
  });

  it('announces the result and disables the button when everything is counted', async () => {
    const runner = mount(ready);
    await countWords(runner);
    expect(container.querySelector('.progress')?.textContent).toBe(
      'Fertig: 6 Wörter auf 2 Seiten.',
    );
    expect(button('Wörter zählen')?.disabled).toBe(true);
    expect(container.querySelector('#count-hint')?.textContent).toContain(
      'Alle Seiten sind gezählt.',
    );
  });

  it('asks before an edited transcript is replaced', async () => {
    const runner = mount(ready);
    await countWords(runner);
    type(textarea(), 'von Hand');

    const rotated = [{ ...page('a'), rotation: 90 as const }, page('b')];
    show(runner, ready, rotated);
    expect(container.querySelector('#count-hint')?.textContent).toContain(
      'Seite 1 wurde nach Ihrer Bearbeitung gedreht und nicht neu erkannt.',
    );

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
  });

  it('keeps the same button while running and announces a cancellation', async () => {
    const hanging: TranscriberStatus = {
      state: 'ready',
      demo: false,
      transcriber: { transcribe: () => new Promise(() => undefined) },
    };
    const runner = mount(hanging);
    const original = button('Wörter zählen');
    act(() => original?.click());

    expect(button('Abbrechen')).toBe(original);
    expect(container.querySelector('.progress')?.textContent).toContain('Seite 1 von 2');

    act(() => button('Abbrechen')?.click());
    expect(button('Wörter zählen')).toBe(original);
    expect(container.querySelector('.progress')?.textContent).toBe('Abgebrochen.');
    expect(runner.getState().batch).toBeNull();
  });

  it('reports pages that could not be recognised in the status region', async () => {
    const failing: TranscriberStatus = {
      state: 'ready',
      demo: false,
      transcriber: {
        transcribe: () => Promise.resolve({ ok: false, error: { kind: 'failed', message: 'x' } }),
      },
    };
    const runner = mount(failing);
    await countWords(runner);
    expect(container.querySelector('.progress')?.textContent).toBe(
      'Fertig: 0 Wörter auf 0 Seiten. 2 Seiten nicht erkannt.',
    );
    expect(container.querySelector('[role=alert]')).toBeNull();
    expect(button('Erneut versuchen')).toBeDefined();
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
    expect(container.querySelector('.progress')?.textContent).toContain('0 Wörter');
  });

  it('does not show the blank hint for pages with text', async () => {
    const runner = mount(ready);
    await countWords(runner);
    expect(container.textContent).not.toContain('Keine Schrift erkannt');
  });
});
