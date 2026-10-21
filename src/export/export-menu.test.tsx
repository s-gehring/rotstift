// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProvider } from '../app/app-context.tsx';
import { testAppModel, testToasts, testWork } from '../app/test-app.ts';
import type { RunController } from '../app/types.ts';
import { flattenPages, type Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import { createRunner, type Runner } from '../pipeline/runner.ts';
import type { PageTranscriber, TranscribeResult } from '../pipeline/transcriber.ts';
import { saveCsv } from '../results/save-csv.ts';
import { DEUTSCH } from '../annotations/profile.ts';
import { setupReview } from '../review/test-support.ts';
import type { ToastOptions, Toasts } from '../ui/Toast.tsx';
import { cancelExport } from './export-job.ts';
import { ExportMenu } from './ExportMenu.tsx';
import { canSaveFiles, type SaveOutcome } from './save-file.ts';
import {
  saveClassPdf,
  saveCorrectedPdf,
  saveWordCountPdf,
  type SavePdfOptions,
} from './save-pdf.ts';

vi.mock('../results/save-csv.ts', () => ({ saveCsv: vi.fn<() => void>() }));
vi.mock('./save-file.ts', async (original) => ({
  ...(await original<typeof import('./save-file.ts')>()),
  canSaveFiles: vi.fn<() => boolean>(),
}));
vi.mock('./save-pdf.ts', () => ({
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

const klasse: readonly Arbeit[] = [
  { id: 'anna', name: 'Anna', pages: [page('a1'), page('a2')] },
  { id: 'ben', name: 'Ben', pages: [page('b1')] },
];

const failure = { ok: false, error: { kind: 'failed', message: 'x' } } as const;

function sequence(failing: readonly number[] = []): PageTranscriber {
  const texts = [['eins zwei'], ['drei vier fünf'], ['sechs']];
  let call = 0;
  return {
    transcribe: () => {
      const current = call++;
      if (failing.includes(current)) return Promise.resolve(failure);
      return Promise.resolve({ ok: true, lines: texts[current] ?? [] } as TranscribeResult);
    },
  };
}

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

function firstInput<T>(mock: { mock: { calls: readonly (readonly [T, ...unknown[]])[] } }): T {
  const call = mock.mock.calls[0];
  if (call === undefined) throw new Error('Nicht aufgerufen');
  return call[0];
}

let container: HTMLElement;
let root: Root;
let show: ReturnType<typeof vi.fn<Toasts['show']>>;
let dismiss: ReturnType<typeof vi.fn<Toasts['dismiss']>>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(canSaveFiles).mockReturnValue(true);
  show = vi.fn<Toasts['show']>();
  dismiss = vi.fn<Toasts['dismiss']>();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  cancelExport();
  act(() => root.unmount());
  container.remove();
});

interface Options {
  readonly arbeitId?: string;
  readonly run?: Partial<RunController>;
}

function render(runner: Runner, options: Options = {}) {
  const arbeiten = klasse;
  act(() =>
    root.render(
      <AppProvider
        value={testAppModel({
          importState: { arbeiten },
          work: testWork({ count: { runner, state: runner.getState() } }),
          toasts: testToasts({ show, dismiss }),
          ...(options.run !== undefined && { run: options.run }),
        })}
      >
        <ExportMenu {...(options.arbeitId !== undefined && { arbeitId: options.arbeitId })} />
      </AppProvider>,
    ),
  );
}

function mount(options: Options = {}, transcriber: PageTranscriber | null = null) {
  const runner = createRunner({ render: () => Promise.resolve(new Blob()) });
  runner.setTranscriber(transcriber);
  runner.setPages(flattenPages(klasse));
  render(runner, options);
  return runner;
}

async function countWords(runner: Runner, options: Options = {}) {
  await act(async () => {
    runner.start();
    await vi.waitFor(() => expect(runner.getState().batch).toBeNull());
  });
  render(runner, options);
}

async function counted(options: Options = {}, failing: readonly number[] = []) {
  const runner = mount(options, sequence(failing));
  await countWords(runner, options);
  return runner;
}

const trigger = () => {
  const found = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
  if (found === null) throw new Error('Kein Menü vorhanden');
  return found;
};

function openMenu() {
  act(() => trigger().click());
}

const items = () => [...container.querySelectorAll<HTMLButtonElement>('button[role=menuitem]')];

function item(label: string): HTMLButtonElement {
  const found = items().find((candidate) => candidate.textContent === label);
  if (found === undefined) throw new Error(`Kein Eintrag „${label}“`);
  return found;
}

const isDisabled = (label: string) => item(label).getAttribute('aria-disabled') === 'true';

async function choose(label: string) {
  openMenu();
  await act(async () => {
    item(label).click();
    await Promise.resolve();
  });
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

const hintOf = (label: string) => item(label).getAttribute('title');

const lastShow = (): [string, ToastOptions | undefined] => {
  const call = show.mock.calls.at(-1);
  if (call === undefined) throw new Error('Keine Meldung');
  return [call[0], call[1]];
};

const messages = () =>
  show.mock.calls.filter(([, options]) => options?.progress === undefined).map(([text]) => text);

describe('the export menu without counted pages', () => {
  it('offers the exports but keeps them disabled', () => {
    mount();
    openMenu();
    expect(items().map((entry) => entry.textContent)).toEqual([
      'Klassen-PDF',
      'Tabelle (CSV)',
      'Tabelle kopieren',
    ]);
    expect(items().every((entry) => entry.getAttribute('aria-disabled') === 'true')).toBe(true);
  });

  it('does not run an export when a disabled entry is selected', async () => {
    mount();
    await choose('Tabelle (CSV)');
    expect(saveCsv).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it('keeps every export disabled when no page could be recognised', async () => {
    const runner = mount({ arbeitId: 'anna' }, sequence([0, 1, 2]));
    await countWords(runner, { arbeitId: 'anna' });
    openMenu();
    expect(items().map((entry) => entry.getAttribute('aria-disabled'))).toEqual([
      'true',
      'true',
      'true',
      'true',
    ]);
  });
});

describe('the export menu with counted pages', () => {
  it('enables the class exports', async () => {
    await counted();
    openMenu();
    expect(isDisabled('Klassen-PDF')).toBe(false);
    expect(isDisabled('Tabelle (CSV)')).toBe(false);
    expect(isDisabled('Tabelle kopieren')).toBe(false);
    expect(items().map((entry) => entry.textContent)).not.toContain('Diese Arbeit als PDF');
  });

  it('disables every export while words are being counted', async () => {
    await counted({ run: { running: true } });
    openMenu();
    expect(items().every((entry) => entry.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(trigger().disabled).toBe(false);
  });

  it('hands the CSV text to the save command and reports where it was saved', async () => {
    vi.mocked(saveCsv).mockResolvedValue({ state: 'saved', fileName: 'Klasse.csv' });
    await counted();
    await choose('Tabelle (CSV)');
    expect(saveCsv).toHaveBeenCalledWith(
      '﻿Name;Seiten;Wörter;Hinweis\r\nAnna;2;5;\r\nBen;1;1;\r\nGesamt;3;6;\r\n',
      'Wortzahlen',
    );
    expect(show).toHaveBeenCalledExactlyOnceWith('Gespeichert als „Klasse.csv“.', {
      tone: 'info',
    });
  });

  it('says that an existing CSV file was not overwritten', async () => {
    vi.mocked(saveCsv).mockResolvedValue({ state: 'exists', fileName: 'klasse.csv' });
    await counted();
    await choose('Tabelle (CSV)');
    expect(show).toHaveBeenCalledOnce();
    const [message, options] = show.mock.calls[0] ?? [];
    expect(message).toContain('„klasse.csv“ gibt es bereits und wurde nicht überschrieben');
    expect(message).toContain('„.csv“');
    expect(options).toEqual({ tone: 'error' });
  });

  it('stays silent when the CSV save dialog is cancelled', async () => {
    vi.mocked(saveCsv).mockResolvedValue({ state: 'cancelled' });
    await counted();
    await choose('Tabelle (CSV)');
    expect(saveCsv).toHaveBeenCalledOnce();
    expect(show).not.toHaveBeenCalled();
  });

  it('copies a tab separated table', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await counted();
    await choose('Tabelle kopieren');
    expect(writeText).toHaveBeenCalledWith(
      'Name\tSeiten\tWörter\tHinweis\nAnna\t2\t5\t\nBen\t1\t1\t\nGesamt\t3\t6\t',
    );
    expect(show).toHaveBeenCalledExactlyOnceWith('Tabelle kopiert.');
  });

  it('reports an error when the clipboard is not available', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>(() => Promise.reject(new Error('x')));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await counted();
    await choose('Tabelle kopieren');
    expect(show).toHaveBeenCalledExactlyOnceWith('Kopieren war nicht möglich.', {
      tone: 'error',
    });
  });
});

describe('the PDF export', () => {
  it('saves all Arbeiten into one class PDF', async () => {
    vi.mocked(saveClassPdf).mockResolvedValue({ state: 'saved', fileName: 'Klasse.pdf' });
    await counted();
    await choose('Klassen-PDF');
    const input = firstInput(vi.mocked(saveClassPdf));
    expect(input.map((entry) => [entry.kind, entry.title, entry.pages.length])).toEqual([
      ['wordCount', 'Anna', 2],
      ['wordCount', 'Ben', 1],
    ]);
    expect(lastShow()).toEqual(['Gespeichert als „Klasse.pdf“.', { tone: 'info' }]);
  });

  it('saves the word count PDF of one Arbeit with its counted pages', async () => {
    vi.mocked(saveWordCountPdf).mockResolvedValue({ state: 'saved', fileName: 'Ben.pdf' });
    await counted({ arbeitId: 'ben' });
    await choose('Diese Arbeit als PDF');
    expect(saveClassPdf).not.toHaveBeenCalled();
    const input = firstInput(vi.mocked(saveWordCountPdf));
    expect(input.title).toBe('Ben');
    expect(input.pages).toHaveLength(1);
    expect(input.words).toEqual([1]);
    expect(lastShow()).toEqual(['Gespeichert als „Ben.pdf“.', { tone: 'info' }]);
  });

  it('lists the PDF of one Arbeit before the class exports', async () => {
    await counted({ arbeitId: 'anna' });
    openMenu();
    expect(items().map((entry) => entry.textContent)).toEqual([
      'Diese Arbeit als PDF',
      'Klassen-PDF',
      'Tabelle (CSV)',
      'Tabelle kopieren',
    ]);
  });

  it('disables the PDF of an Arbeit that is not counted while the class can still be exported', async () => {
    await counted({ arbeitId: 'ben' }, [2]);
    openMenu();
    expect(isDisabled('Diese Arbeit als PDF')).toBe(true);
    expect(hintOf('Diese Arbeit als PDF')).toBe('Diese Arbeit ist noch nicht gezählt');
    expect(isDisabled('Klassen-PDF')).toBe(false);
  });

  it('shows the progress in a toast with a cancel action and blocks further exports', async () => {
    const save = pendingSave();
    vi.mocked(saveClassPdf).mockImplementation(save.implementation);
    await counted();
    openMenu();
    act(() => item('Klassen-PDF').click());

    const [preparing, first] = lastShow();
    expect(preparing).toBe('PDF wird vorbereitet …');
    expect(first?.key).toBe('export');
    expect(first?.progress).toEqual({ value: null, max: 1 });
    expect(first?.action?.label).toBe('Abbrechen');

    act(() => save.options()?.onProgress?.(2, 3));
    const [text, options] = lastShow();
    expect(text).toBe('PDF wird erstellt: Seite 2 von 3');
    expect(options?.key).toBe('export');
    expect(options?.progress).toEqual({ value: 2, max: 3 });

    openMenu();
    expect(isDisabled('Klassen-PDF')).toBe(true);
    expect(hintOf('Klassen-PDF')).toBe('Ein Export läuft gerade');
    expect(isDisabled('Tabelle kopieren')).toBe(true);

    save.pending.resolve({ state: 'saved', fileName: 'Klasse.pdf' });
    await flush();
    expect(lastShow()).toEqual(['Gespeichert als „Klasse.pdf“.', { tone: 'info' }]);
    expect(isDisabled('Klassen-PDF')).toBe(false);
  });

  it('hides the progress while the save dialog is open and stays silent when it is cancelled', async () => {
    const save = pendingSave();
    vi.mocked(saveClassPdf).mockImplementation(save.implementation);
    await counted();
    openMenu();
    act(() => item('Klassen-PDF').click());
    act(() => save.options()?.onProgress?.(3, 3));
    act(() => save.options()?.onPhase?.('saving'));
    expect(dismiss).toHaveBeenCalledOnce();

    save.pending.resolve({ state: 'cancelled' });
    await flush();
    expect(messages()).toEqual([]);
    openMenu();
    expect(isDisabled('Klassen-PDF')).toBe(false);
  });

  it('aborts the export from the toast and says so', async () => {
    const save = pendingSave();
    vi.mocked(saveClassPdf).mockImplementation(save.implementation);
    await counted();
    openMenu();
    act(() => item('Klassen-PDF').click());
    act(() => lastShow()[1]?.action?.onAction());
    expect(save.options()?.signal?.aborted).toBe(true);

    save.pending.resolve({ state: 'cancelled' });
    await flush();
    expect(messages()).toEqual(['Export abgebrochen.']);
  });

  it('keeps a running export when the menu disappears, for example after leaving the Arbeit', async () => {
    const save = pendingSave();
    vi.mocked(saveClassPdf).mockImplementation(save.implementation);
    await counted();
    openMenu();
    act(() => item('Klassen-PDF').click());

    act(() => root.render(<></>));
    expect(save.options()?.signal?.aborted).toBe(false);
    save.pending.resolve({ state: 'saved', fileName: 'Klasse.pdf' });
    await flush();
    expect(messages()).toEqual(['Gespeichert als „Klasse.pdf“.']);
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
  ] as const)('explains %j in German as an error', async (outcome, expected) => {
    vi.mocked(saveClassPdf).mockResolvedValue(outcome);
    await counted();
    await choose('Klassen-PDF');
    const [message, options] = lastShow();
    expect(message).toContain(expected);
    expect(options).toEqual({ tone: 'error' });
  });
});

describe('exports that are not possible', () => {
  it('grey out saving files in the browser but still copy the table', async () => {
    vi.mocked(canSaveFiles).mockReturnValue(false);
    await counted({ arbeitId: 'anna' });
    openMenu();
    for (const label of ['Diese Arbeit als PDF', 'Klassen-PDF', 'Tabelle (CSV)']) {
      expect(isDisabled(label)).toBe(true);
      expect(hintOf(label)).toBe('Nur in der Rotstift-App');
    }
    expect(isDisabled('Tabelle kopieren')).toBe(false);
    expect(hintOf('Tabelle kopieren')).toBeNull();
  });

  it('say why while a run is going on or before anything is counted', async () => {
    await counted({ run: { running: true } });
    openMenu();
    expect(hintOf('Klassen-PDF')).toBe('Erst nach dem Lauf möglich');
    act(() => root.unmount());
    root = createRoot(container);
    mount();
    openMenu();
    expect(hintOf('Tabelle (CSV)')).toBe('Noch nichts gezählt');
  });
});

async function corrected(preview = false) {
  const { pages, flow, runner, corrector } = setupReview(['a', 'b']);
  const [a, b] = pages;
  if (a === undefined || b === undefined) throw new Error('missing pages');
  if (preview) flow.setCorrector(corrector, true);
  await flow.start(pages, DEUTSCH);
  const arbeiten: Arbeit[] = [
    { id: 'ada', name: 'Ada', pages: [a] },
    { id: 'ben', name: 'Ben', pages: [b] },
  ];
  act(() =>
    root.render(
      <AppProvider
        value={testAppModel({
          importState: { arbeiten },
          work: testWork({
            count: { runner, state: runner.getState() },
            review: { flow, state: flow.getState() },
          }),
          toasts: testToasts({ show, dismiss }),
        })}
      >
        <ExportMenu arbeitId="ada" />
      </AppProvider>,
    ),
  );
}

describe('the corrected PDF', () => {
  it('saves the corrected Arbeit with its statistics and the review footer', async () => {
    vi.mocked(saveCorrectedPdf).mockResolvedValue({ state: 'saved', fileName: 'Ada.pdf' });
    await corrected();
    await choose('Diese Arbeit als PDF');
    const input = firstInput(vi.mocked(saveCorrectedPdf));
    expect(input.title).toBe('Ada');
    expect(input.statistics.errors).toBe(1);
    expect(vi.mocked(saveCorrectedPdf).mock.calls[0]?.[1]?.footer).toBe(
      'Vorschau: automatisch erstellte Korrektur, bitte prüfen',
    );
    expect(lastShow()).toEqual(['Gespeichert als „Ada.pdf“.', { tone: 'info' }]);
  });

  it('keeps demo corrections out of the PDFs', async () => {
    await corrected(true);
    openMenu();
    expect(hintOf('Diese Arbeit als PDF')).toBe('Nicht mit Demo-Korrekturen');
    expect(hintOf('Klassen-PDF')).toBe('Nicht mit Demo-Korrekturen');
    expect(isDisabled('Tabelle (CSV)')).toBe(false);
  });

  it('adds the errors per type of the profile to the class table', async () => {
    vi.mocked(saveCsv).mockResolvedValue({ state: 'saved', fileName: 'Klassenübersicht.csv' });
    await corrected();
    await choose('Tabelle (CSV)');
    const [csv, fileName] = vi.mocked(saveCsv).mock.calls[0] ?? [];
    const [head, ada] = csv?.replace('\uFEFF', '').split('\r\n') ?? [];
    expect(head).toBe(
      `Name;Seiten;Wörter;Fehler;Fehler je 100 Wörter;${DEUTSCH.allowedTypes.join(';')};Hinweis`,
    );
    expect(ada?.split(';').slice(0, 5)).toEqual([
      'Ada',
      '1',
      expect.any(String),
      '1',
      expect.any(String),
    ]);
    expect(fileName).toBe('Klassenübersicht');
  });
});
