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
import { CountControls, CountHint } from './CountControls.tsx';
import { ResultsView } from './ResultsView.tsx';
import { saveCsv } from './save-csv.ts';
import type { SaveOutcome } from '../export/save-file.ts';
import type { SavePdfOptions } from '../export/save-pdf.ts';
import { saveClassPdf, saveWordCountPdf } from '../export/save-pdf.ts';

vi.mock('./save-csv.ts', () => ({ saveCsv: vi.fn<() => void>() }));
vi.mock('../export/save-pdf.ts', () => ({
  saveClassPdf: vi.fn<() => void>(),
  saveWordCountPdf: vi.fn<() => void>(),
  saveCorrectedPdf: vi.fn<() => void>(),
}));

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

function App({
  runner,
  status,
  arbeiten,
  locked = false,
}: {
  runner: Runner;
  status: TranscriberStatus | null;
  arbeiten: readonly Arbeit[];
  locked?: boolean;
}) {
  const state = useSyncExternalStore(runner.subscribe, runner.getState);
  const count = { runner, state };
  return (
    <>
      <CountControls count={count} status={status} arbeiten={arbeiten} />
      <CountHint count={count} status={status} arbeiten={arbeiten} />
      <ResultsView
        arbeiten={arbeiten}
        count={count}
        canRetry={status?.state === 'ready'}
        locked={locked}
      />
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

function show(runner: Runner, status: TranscriberStatus | null, arbeiten: readonly Arbeit[]) {
  runner.setPages(flattenPages(arbeiten));
  act(() => root.render(<App runner={runner} status={status} arbeiten={arbeiten} />));
}

function mount(status: TranscriberStatus | null, arbeiten: readonly Arbeit[] = initialArbeiten) {
  const runner = createRunner({ render: () => Promise.resolve(new Blob()) });
  runner.setTranscriber(status?.state === 'ready' ? status.transcriber : null);
  show(runner, status, arbeiten);
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

  it('shows a hint while the availability is being loaded', () => {
    mount(null);
    expect(button('Wörter zählen')?.disabled).toBe(true);
    expect(container.querySelector('#count-hint')?.textContent).toBe(
      'Texterkennung wird geladen …',
    );
  });

  it('explains the check of the model files and shows how far it got', () => {
    const runner = createRunner({ render: () => Promise.resolve(new Blob()) });
    act(() =>
      root.render(
        <CountHint
          count={{ runner, state: runner.getState() }}
          status={{ state: 'needs-model', problem: 'verifying' }}
          arbeiten={initialArbeiten}
          download={{
            modelId: 'glm-ocr-q8',
            state: 'verifying',
            downloadedBytes: 400_000_000,
            totalBytes: 1_400_000_000,
          }}
        />,
      ),
    );
    const hint = container.querySelector('#count-hint');
    expect(hint?.textContent).toBe(
      'Rotstift prüft einmalig, ob die Dateien der Texterkennung vollständig und unbeschädigt sind. 400 MB von 1.400 MB geprüft.',
    );
    const bar = hint?.querySelector('progress');
    expect(bar?.getAttribute('value')).toBe('400000000');
    expect(bar?.getAttribute('max')).toBe('1400000000');
  });

  it('says when the model could not be looked up and retries on request', () => {
    const runner = createRunner({ render: () => Promise.resolve(new Blob()) });
    const onRetry = vi.fn<() => void>();
    act(() =>
      root.render(
        <CountHint
          count={{ runner, state: runner.getState() }}
          status={null}
          arbeiten={initialArbeiten}
          loadError={{ kind: 'io', detail: 'unknown path' }}
          onRetry={onRetry}
        />,
      ),
    );
    expect(container.querySelector('#count-hint')?.textContent).toContain(
      'Rotstift konnte die Texterkennung nicht laden.',
    );
    act(() => button('Erneut versuchen')?.click());
    expect(onRetry).toHaveBeenCalledOnce();
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
          arbeiten={initialArbeiten}
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
          arbeiten={initialArbeiten}
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

  it('locks editing, retrying and saving while a review runs', async () => {
    const runner = mount(ready);
    await countWords(runner);
    act(() =>
      root.render(<App runner={runner} status={ready} arbeiten={initialArbeiten} locked />),
    );
    const lock = textarea().closest('fieldset');
    expect(lock?.disabled).toBe(true);
    expect(button('Als CSV speichern')?.closest('fieldset')).toBe(lock);
    expect(button('Klassen-PDF speichern')?.closest('fieldset')).toBe(lock);
    expect(container.querySelector('.results')?.textContent).toContain(
      'Während der Berichtigung lassen sich Wortzahlen nicht ändern oder speichern.',
    );
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

    const rotated = [arbeit('x', 'Aufsatz', [{ ...page('a'), rotation: 90 as const }, page('b')])];
    show(runner, ready, rotated);
    expect(container.querySelector('#count-hint')?.textContent).toContain(
      'Seite 1 von Aufsatz wurde nach Ihrer Bearbeitung gedreht und nicht neu erkannt.',
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
function pendingSave() {
  const pending = deferred<SaveOutcome>();
  let options: SavePdfOptions | undefined;
  return {
    pending,
    implementation: (_input: unknown, given?: SavePdfOptions) => {
      options = given;
      return pending.promise;
    },
    options: () => options,
  };
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

function firstInput<T>(mock: { mock: { calls: readonly (readonly [T, ...unknown[]])[] } }): T {
  const call = mock.mock.calls[0];
  if (call === undefined) throw new Error('Nicht aufgerufen');
  return call[0];
}

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

  it('copies a tab separated table', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const runner = mount(sequence(), klasse);
    await countWords(runner);
    await act(async () => {
      button('In die Zwischenablage kopieren')?.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(
      'Name\tSeiten\tWörter\tHinweis\nAnna\t2\t5\t\nBen\t1\t1\t\nGesamt\t3\t6\t',
    );
    expect(container.textContent).toContain('In die Zwischenablage kopiert.');
  });

  it('hands the CSV text to the save command and reports where it was saved', async () => {
    vi.mocked(saveCsv).mockResolvedValue({ state: 'saved', fileName: 'Klasse.csv' });
    const runner = mount(sequence(), klasse);
    await countWords(runner);
    await act(async () => {
      button('Als CSV speichern')?.click();
      await Promise.resolve();
    });
    expect(saveCsv).toHaveBeenCalledWith(
      '\uFEFFName;Seiten;Wörter;Hinweis\r\nAnna;2;5;\r\nBen;1;1;\r\nGesamt;3;6;\r\n',
      'Wortzahlen',
    );
    expect(container.textContent).toContain('Gespeichert als „Klasse.csv“.');
  });

  it('says that an existing file was not overwritten', async () => {
    vi.mocked(saveCsv).mockResolvedValue({ state: 'exists', fileName: 'klasse.csv' });
    const runner = mount(sequence(), klasse);
    await countWords(runner);
    await act(async () => {
      button('Als CSV speichern')?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain(
      '„klasse.csv“ gibt es bereits und wurde nicht überschrieben',
    );
  });

  it('stays silent when the save dialog is cancelled', async () => {
    vi.mocked(saveCsv).mockResolvedValue({ state: 'cancelled' });
    const runner = mount(sequence(), klasse);
    await countWords(runner);
    await act(async () => {
      button('Als CSV speichern')?.click();
      await Promise.resolve();
    });
    expect(container.querySelector('.export-actions [role=status]')?.textContent).toBe('');
  });

  describe('PDF export', () => {
    it('offers a PDF button per Arbeit and one for the class', async () => {
      const runner = mount(sequence(), klasse);
      await countWords(runner);
      expect(button('Klassen-PDF speichern')?.disabled).toBe(false);
      const labels = [...container.querySelectorAll('button')]
        .map((candidate) => candidate.getAttribute('aria-label'))
        .filter((label) => label?.startsWith('Als PDF speichern'));
      expect(labels).toEqual(['Als PDF speichern: Anna', 'Als PDF speichern: Ben']);
    });

    it('keeps the PDF buttons disabled while nothing is counted', async () => {
      const failing: TranscriberStatus = {
        state: 'ready',
        demo: false,
        transcriber: {
          transcribe: () => Promise.resolve({ ok: false, error: { kind: 'failed', message: 'x' } }),
        },
      };
      const runner = mount(failing, klasse);
      await countWords(runner);
      expect(button('Klassen-PDF speichern')?.disabled).toBe(true);
      expect(
        container.querySelector<HTMLButtonElement>('[aria-label="Als PDF speichern: Anna"]')
          ?.disabled,
      ).toBe(true);
    });

    it('saves the word count PDF of one Arbeit with its counted pages', async () => {
      vi.mocked(saveWordCountPdf).mockResolvedValue({ state: 'saved', fileName: 'Ben.pdf' });
      const runner = mount(sequence(), klasse);
      await countWords(runner);
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('[aria-label="Als PDF speichern: Ben"]')
          ?.click();
        await Promise.resolve();
      });
      const input = firstInput(vi.mocked(saveWordCountPdf));
      expect(input.title).toBe('Ben');
      expect(input.pages).toHaveLength(1);
      expect(input.words).toEqual([1]);
      expect(container.textContent).toContain('Gespeichert als „Ben.pdf“.');
    });

    it('saves all Arbeiten into one class PDF', async () => {
      vi.mocked(saveClassPdf).mockResolvedValue({ state: 'saved', fileName: 'Klasse.pdf' });
      const runner = mount(sequence(), klasse);
      await countWords(runner);
      await act(async () => {
        button('Klassen-PDF speichern')?.click();
        await Promise.resolve();
      });
      const input = firstInput(vi.mocked(saveClassPdf));
      expect(input.map((entry) => [entry.kind, entry.title, entry.pages.length])).toEqual([
        ['wordCount', 'Anna', 2],
        ['wordCount', 'Ben', 1],
      ]);
      expect(container.textContent).toContain('Gespeichert als „Klasse.pdf“.');
    });

    it('shows progress, blocks other exports and returns the focus afterwards', async () => {
      const save = pendingSave();
      vi.mocked(saveClassPdf).mockImplementation(save.implementation);
      const runner = mount(sequence(), klasse);
      await countWords(runner);
      const trigger = button('Klassen-PDF speichern');
      act(() => trigger?.click());

      expect(container.querySelector('progress')).not.toBeNull();
      expect(container.querySelector('.pdf-progress')?.textContent).toContain(
        'PDF wird vorbereitet',
      );
      expect(document.activeElement).toBe(button('Abbrechen'));
      expect(trigger?.disabled).toBe(true);
      expect(
        container.querySelector<HTMLButtonElement>('[aria-label="Als PDF speichern: Anna"]')
          ?.disabled,
      ).toBe(true);

      act(() => save.options()?.onProgress?.(2, 3));
      expect(container.querySelector('.pdf-progress')?.textContent).toContain('Seite 2 von 3');
      const bar = container.querySelector('progress');
      expect([bar?.value, bar?.max]).toEqual([2, 3]);

      save.pending.resolve({ state: 'saved', fileName: 'Klasse.pdf' });
      await flush();
      expect(container.querySelector('progress')).toBeNull();
      expect(button('Klassen-PDF speichern')?.disabled).toBe(false);
      expect(document.activeElement).toBe(button('Klassen-PDF speichern'));
    });

    it('says that a location is being chosen and offers no useless cancel while the dialog is open', async () => {
      const save = pendingSave();
      vi.mocked(saveClassPdf).mockImplementation(save.implementation);
      const runner = mount(sequence(), klasse);
      await countWords(runner);
      act(() => button('Klassen-PDF speichern')?.click());
      act(() => save.options()?.onProgress?.(3, 3));
      act(() => save.options()?.onPhase?.('saving'));

      expect(container.querySelector('.pdf-progress')?.textContent).toBe('Speicherort wählen …');
      expect(container.querySelector('.pdf-progress')?.getAttribute('role')).toBe('status');
      expect(container.querySelector('progress')).toBeNull();
      expect(button('Abbrechen')).toBeUndefined();

      save.pending.resolve({ state: 'cancelled' });
      await flush();
      expect(container.querySelector('.pdf-progress')).toBeNull();
      expect(button('Klassen-PDF speichern')?.disabled).toBe(false);
    });

    it('shows the progress of a single Arbeit next to its own button', async () => {
      const save = pendingSave();
      vi.mocked(saveWordCountPdf).mockImplementation(save.implementation);
      const runner = mount(sequence(), klasse);
      await countWords(runner);
      act(() =>
        container
          .querySelector<HTMLButtonElement>('[aria-label="Als PDF speichern: Ben"]')
          ?.click(),
      );
      const sections = [...container.querySelectorAll('.arbeit-result')];
      expect(sections[0]?.querySelector('progress')).toBeNull();
      expect(sections[1]?.querySelector('progress')).not.toBeNull();
      save.pending.resolve({ state: 'cancelled' });
      await flush();
    });

    it('aborts the export on request and says so', async () => {
      const save = pendingSave();
      vi.mocked(saveClassPdf).mockImplementation(save.implementation);
      const runner = mount(sequence(), klasse);
      await countWords(runner);
      act(() => button('Klassen-PDF speichern')?.click());
      act(() => button('Abbrechen')?.click());
      expect(save.options()?.signal?.aborted).toBe(true);
      save.pending.resolve({ state: 'cancelled' });
      await flush();
      expect(container.textContent).toContain('Das Speichern wurde abgebrochen.');
      expect(container.querySelector('progress')).toBeNull();
    });

    it('aborts a running export when the view disappears', async () => {
      const save = pendingSave();
      vi.mocked(saveClassPdf).mockImplementation(save.implementation);
      const runner = mount(sequence(), klasse);
      await countWords(runner);
      act(() => button('Klassen-PDF speichern')?.click());
      act(() => root.render(<></>));
      expect(save.options()?.signal?.aborted).toBe(true);
      save.pending.resolve({ state: 'cancelled' });
      await flush();
    });

    it('stays silent when the save dialog is cancelled', async () => {
      vi.mocked(saveClassPdf).mockResolvedValue({ state: 'cancelled' });
      const runner = mount(sequence(), klasse);
      await countWords(runner);
      await act(async () => {
        button('Klassen-PDF speichern')?.click();
        await Promise.resolve();
      });
      expect(container.querySelector('.export-actions [role=status]')?.textContent).toBe('');
    });

    it.each([
      [
        { state: 'exists', fileName: 'a.pdf' },
        '„a.pdf“ gibt es bereits und wurde nicht überschrieben',
      ],
      [{ state: 'exists', fileName: 'a.pdf' }, 'Dateinamen mit „.pdf“'],
      [{ state: 'failed' }, 'Das PDF konnte nicht gespeichert werden.'],
      [{ state: 'failed', reason: 'tooLarge' }, 'mehr als 200 MB'],
      [{ state: 'failed', reason: 'build' }, 'konnte nicht erstellt werden'],
      [{ state: 'unavailable' }, 'nur in der Rotstift-App möglich'],
    ] as const)('explains %j in German', async (outcome, expected) => {
      vi.mocked(saveClassPdf).mockResolvedValue(outcome);
      const runner = mount(sequence(), klasse);
      await countWords(runner);
      await act(async () => {
        button('Klassen-PDF speichern')?.click();
        await Promise.resolve();
      });
      expect(container.querySelector('.export-actions [role=status]')?.textContent).toContain(
        expected,
      );
    });

    it('does not offer the PDF export while words are being counted', () => {
      const hanging: TranscriberStatus = {
        state: 'ready',
        demo: false,
        transcriber: { transcribe: () => new Promise(() => undefined) },
      };
      const runner = mount(hanging, klasse);
      act(() => runner.start());
      expect(button('Klassen-PDF speichern')?.disabled ?? true).toBe(true);
    });
  });

  it('keeps the export buttons disabled until a page is counted', () => {
    mount(ready, klasse);
    expect(container.querySelector('.results')).toBeNull();
  });
});
