// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProvider } from '../app/app-context.tsx';
import { testAppModel } from '../app/test-app.ts';
import type { ModelRole } from '../app/types.ts';
import { ModelCallError, type ModelClient } from './client.ts';
import { defaultCorrector, recommendModel } from './registry.ts';
import { SetupDialog } from './SetupDialog.tsx';
import { fakeModelClient, type FakeClientOptions } from './test-client.ts';
import type { DownloadEvent } from './types.ts';
import { useCorrectorModelSetup, useModelSetup } from './use-model-setup.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const transcriber = recommendModel();
const corrector = defaultCorrector();
const GIB = 1024 ** 3;
const BOTH: readonly ModelRole[] = ['transcriber', 'corrector'];

interface HarnessProps {
  readonly client: ModelClient | null;
  readonly roles: readonly ModelRole[];
  readonly open?: boolean;
  readonly onClose?: () => void;
}

function Harness({ client, roles, open = true, onClose = () => undefined }: HarnessProps) {
  const transcriberSetup = useModelSetup(client);
  const correctorSetup = useCorrectorModelSetup(client);
  const app = testAppModel({
    models: {
      transcriber: transcriberSetup,
      corrector: correctorSetup,
      setup: { open, roles, pendingRun: null, show: () => undefined, close: onClose },
    },
  });
  return (
    <AppProvider value={app}>
      <SetupDialog />
    </AppProvider>
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
  vi.restoreAllMocks();
});

const rows = () =>
  [...container.querySelectorAll('.setup-models li[data-state]')].map((row) =>
    row.getAttribute('data-state'),
  );

const alerts = () => [...container.querySelectorAll('[role="alert"]')].map((el) => el.textContent);

const progressBar = () => container.querySelector('[role="progressbar"]');

const buttonIn = (parent: ParentNode, label: string) =>
  [...parent.querySelectorAll('button')].find((candidate) => candidate.textContent === label);

const button = (label: string) => buttonIn(container, label);

const sectionOf = (label: string) => {
  const found = container.querySelector<HTMLElement>(`section[aria-label="${label}"]`);
  if (found === null) throw new Error(`no section ${label}`);
  return found;
};

const click = (target: HTMLElement | undefined) =>
  act(async () => {
    target?.click();
    await Promise.resolve();
  });

const progress = (modelId: string, downloadedBytes: number, totalBytes: number) =>
  ({ modelId, state: 'progress', downloadedBytes, totalBytes }) as const;

const emit = (fake: ReturnType<typeof fakeModelClient>, ...events: readonly DownloadEvent[]) =>
  act(() => {
    for (const event of events) fake.dispatch(event);
  });

async function mount(
  props: Omit<HarnessProps, 'client'>,
  options: FakeClientOptions = {},
  expectedRows: readonly string[] = props.roles.map(() => 'missing'),
) {
  const fake = fakeModelClient(options);
  await act(async () => {
    root.render(<Harness client={fake.client} {...props} />);
    await Promise.resolve();
  });
  await vi.waitFor(() => expect(rows()).toEqual(expectedRows));
  return fake;
}

describe('SetupDialog content', () => {
  it('lists both roles with their sizes and the combined total', async () => {
    await mount({ roles: BOTH });
    const dialog = container.querySelector('dialog');
    expect(dialog?.querySelector('h2')?.textContent).toBe('Einmalige Einrichtung');
    const listed = [...container.querySelectorAll('.setup-models li')].map((row) =>
      [...row.querySelectorAll('span')].map((cell) => cell.textContent.trim()),
    );
    expect(listed).toEqual([
      ['Texterkennung', '1,4 GB', ''],
      ['Korrektur', '2,8 GB', ''],
      ['Zusammen', '4,3 GB', ''],
    ]);
    expect(button('Herunterladen')?.disabled).toBe(false);
    expect(progressBar()).toBeNull();
  });

  it('omits the total row when only one role is requested', async () => {
    await mount({ roles: ['corrector'] });
    expect(container.querySelector('.setup-models-total')).toBeNull();
    expect(container.querySelectorAll('.setup-models li')).toHaveLength(1);
    expect(container.querySelector('.setup-models')?.textContent).toContain('Korrektur');
    expect(container.querySelector('.setup-models')?.textContent).not.toContain('Texterkennung');
  });

  it('marks finished roles as ready and has nothing left to download when all are ready', async () => {
    await mount(
      { roles: BOTH },
      { states: { [transcriber.id]: 'ready', [corrector.id]: 'ready' } },
      ['ready', 'ready'],
    );
    expect(container.querySelector('.setup-models')?.textContent).toContain('Bereit');
    expect(button('Herunterladen')?.disabled).toBe(true);
  });

  it('renders no content while closed', async () => {
    await mount({ roles: BOTH, open: false }, {}, []);
    expect(container.querySelector('dialog')?.hasAttribute('open')).toBe(false);
    expect(container.querySelector('.dialog-frame')).toBeNull();
  });

  it('renders no content outside the desktop app', async () => {
    await act(async () => {
      root.render(<Harness client={null} roles={BOTH} />);
      await Promise.resolve();
    });
    expect(container.querySelector('.dialog-frame')).toBeNull();
  });

  it('closes through Abbrechen while nothing is downloading', async () => {
    const onClose = vi.fn<() => void>();
    const fake = await mount({ roles: BOTH, onClose });
    await click(button('Abbrechen'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(fake.cancelDownload).not.toHaveBeenCalled();
  });
});

describe('SetupDialog partly downloaded models', () => {
  const PRESENT = 950_000_000;

  it('lists and sums only what is still to be loaded', async () => {
    await mount({ roles: BOTH }, { present: { [transcriber.id]: PRESENT } });
    const listed = [...container.querySelectorAll('.setup-models li')].map((row) =>
      [...row.querySelectorAll('span')].map((cell) => cell.textContent.trim()),
    );
    expect(listed).toEqual([
      ['Texterkennung', '485 MB', ''],
      ['Korrektur', '2,8 GB', ''],
      ['Zusammen', '3,3 GB', ''],
    ]);
  });

  it('measures the progress against the part that is loaded now', async () => {
    const fake = await mount(
      { roles: ['transcriber'] },
      { present: { [transcriber.id]: PRESENT } },
    );
    await click(button('Herunterladen'));
    await vi.waitFor(() => expect(rows()).toEqual(['downloading']));
    emit(fake, progress(transcriber.id, PRESENT + 100_000_000, 1_434_837_056));
    expect(container.querySelector('.setup-progress-text')?.textContent).toBe('100 MB von 485 MB');
    const bar = progressBar();
    expect(bar?.getAttribute('aria-valuenow')).toBe('100000000');
    expect(bar?.getAttribute('aria-valuemax')).toBe(String(1_434_837_056 - PRESENT));
  });

  it('checks the free disk space against the missing part only', async () => {
    await mount(
      { roles: ['transcriber'] },
      {
        present: { [transcriber.id]: PRESENT },
        hardware: { totalRamBytes: 16 * GIB, freeDiskBytes: 600_000_000 },
      },
    );
    expect(container.querySelector('.setup-warning')).toBeNull();
  });
});

describe('SetupDialog focus', () => {
  it('puts the focus on Herunterladen when it opens', async () => {
    await mount({ roles: BOTH });
    expect(document.activeElement).toBe(button('Herunterladen'));
  });
});

describe('SetupDialog warnings', () => {
  it('warns in one sentence when the machine has less memory than recommended', async () => {
    await mount({ roles: BOTH }, { hardware: { totalRamBytes: 4 * GIB, freeDiskBytes: 100e9 } });
    await vi.waitFor(() =>
      expect(container.querySelector('.setup-warning')?.textContent).toBe(
        'Dieser Rechner hat 4,0 GB Arbeitsspeicher, empfohlen sind 8 GB.',
      ),
    );
    expect(container.querySelectorAll('.setup-warning')).toHaveLength(1);
  });

  it('does not warn about memory at the recommended size or above', async () => {
    await mount({ roles: BOTH }, { hardware: { totalRamBytes: 8 * GIB, freeDiskBytes: 100e9 } });
    await vi.waitFor(() => expect(rows()).toEqual(['missing', 'missing']));
    expect(container.querySelector('.setup-warning')).toBeNull();
  });

  it('warns when less disk space is free than the downloads need', async () => {
    await mount({ roles: BOTH }, { hardware: { totalRamBytes: 16 * GIB, freeDiskBytes: 2e9 } });
    await vi.waitFor(() =>
      expect(container.querySelector('.setup-warning')?.textContent).toBe(
        'Frei sind nur 2,0 GB, gebraucht werden 4,3 GB.',
      ),
    );
  });

  it('only counts the roles that still need a download for the disk warning', async () => {
    await mount(
      { roles: BOTH },
      {
        states: { [transcriber.id]: 'ready' },
        hardware: { totalRamBytes: 16 * GIB, freeDiskBytes: 3e9 },
      },
      ['ready', 'missing'],
    );
    expect(container.querySelector('.setup-warning')).toBeNull();
  });
});

describe('SetupDialog download', () => {
  it('downloads only the roles that are not ready and leaves finished roles out of the progress', async () => {
    const fake = await mount({ roles: BOTH }, { states: { [transcriber.id]: 'ready' } }, [
      'ready',
      'missing',
    ]);
    await click(button('Herunterladen'));
    expect(fake.startDownload).toHaveBeenCalledExactlyOnceWith(corrector.id);
    await vi.waitFor(() => expect(rows()).toEqual(['ready', 'downloading']));

    emit(fake, {
      modelId: corrector.id,
      state: 'progress',
      downloadedBytes: 1_000_000_000,
      totalBytes: 2_841_481_184,
    });
    const bar = progressBar();
    expect(bar?.getAttribute('aria-label')).toBe('Fortschritt der Einrichtung');
    expect(bar?.getAttribute('aria-valuenow')).toBe('1000000000');
    expect(bar?.getAttribute('aria-valuemax')).toBe('2841481184');
    expect(bar?.getAttribute('aria-valuetext')).toBe('1,0 GB von 2,8 GB');
    expect(container.querySelector('.setup-progress-text')?.textContent).toBe('1,0 GB von 2,8 GB');

    emit(fake, { modelId: corrector.id, state: 'done' });
    await vi.waitFor(() => expect(rows()).toEqual(['ready', 'ready']));
    expect(progressBar()).toBeNull();
  });

  it('starts all downloads at once, shows bytes with remaining time and cancels them together', async () => {
    const clock = { now: 0 };
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    const onClose = vi.fn<() => void>();
    const fake = await mount({ roles: BOTH, onClose });

    await click(button('Herunterladen'));
    expect(fake.startDownload).toHaveBeenCalledTimes(2);
    expect(fake.startDownload).toHaveBeenCalledWith(transcriber.id);
    expect(fake.startDownload).toHaveBeenCalledWith(corrector.id);
    await vi.waitFor(() => expect(rows()).toEqual(['downloading', 'downloading']));

    clock.now = 0;
    emit(
      fake,
      progress(transcriber.id, 100_000_000, 1_434_837_056),
      progress(corrector.id, 200_000_000, 2_841_481_184),
    );
    expect(container.querySelector('.setup-progress-text')?.textContent).toBe('300 MB von 4,3 GB');
    clock.now = 10_000;
    emit(
      fake,
      progress(transcriber.id, 500_000_000, 1_434_837_056),
      progress(corrector.id, 600_000_000, 2_841_481_184),
    );
    expect(container.querySelector('.setup-progress-text')?.textContent).toBe(
      '1,1 GB von 4,3 GB · noch etwa 55 Sekunden',
    );
    expect(progressBar()?.getAttribute('aria-valuetext')).toBe(
      '1,1 GB von 4,3 GB · noch etwa 55 Sekunden',
    );
    expect(button('Herunterladen')).toBeUndefined();
    expect(button('Dateien auswählen …')).toBeUndefined();

    await click(button('Abbrechen'));
    expect(fake.cancelDownload).toHaveBeenCalledTimes(2);
    expect(fake.cancelDownload).toHaveBeenCalledWith(transcriber.id);
    expect(fake.cancelDownload).toHaveBeenCalledWith(corrector.id);
    expect(onClose).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(rows()).toEqual(['missing', 'missing']));
    expect(progressBar()).toBeNull();
    expect(button('Herunterladen')?.disabled).toBe(false);
  });

  it('shows a failed download with its reason and retries it', async () => {
    const fake = await mount({ roles: ['transcriber'] });
    await click(button('Herunterladen'));
    await vi.waitFor(() => expect(rows()).toEqual(['downloading']));
    emit(
      fake,
      {
        modelId: transcriber.id,
        state: 'progress',
        downloadedBytes: 300_000_000,
        totalBytes: 1_434_837_056,
      },
      { modelId: transcriber.id, state: 'failed', error: { kind: 'network' } },
    );
    await vi.waitFor(() => expect(rows()).toEqual(['missing']));
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toContain(
      'Texterkennung: Die Verbindung zum Download-Server ist abgebrochen.',
    );
    expect(progressBar()).toBeNull();

    await click(button('Erneut versuchen'));
    expect(fake.startDownload).toHaveBeenCalledTimes(2);
    expect(fake.startDownload).toHaveBeenLastCalledWith(transcriber.id);
    await vi.waitFor(() => expect(rows()).toEqual(['downloading']));
    expect(alerts()).toEqual([]);
  });

  it('keeps the other role downloading when one role fails', async () => {
    const fake = await mount({ roles: BOTH });
    await click(button('Herunterladen'));
    await vi.waitFor(() => expect(rows()).toEqual(['downloading', 'downloading']));
    emit(fake, {
      modelId: corrector.id,
      state: 'failed',
      error: { kind: 'insufficientDisk', detail: { needed: 2_841_481_184, available: 1e9 } },
    });
    await vi.waitFor(() => expect(rows()).toEqual(['downloading', 'missing']));
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toContain('Korrektur: Zu wenig freier Speicherplatz');
    expect(alerts()[0]).not.toContain('Texterkennung');
    expect(button('Abbrechen')).toBeDefined();
    expect(button('Herunterladen')).toBeUndefined();
  });
});

describe('SetupDialog recovery', () => {
  it('offers to retry when the model state cannot be loaded and reloads it', async () => {
    const fake = fakeModelClient();
    fake.control.statusError = new ModelCallError({ kind: 'network' });
    await act(async () => {
      root.render(<Harness client={fake.client} roles={['transcriber']} />);
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(alerts()).toHaveLength(1));
    expect(alerts()[0]).toContain('Texterkennung: Die Verbindung zum Download-Server');
    expect(rows()).toEqual(['unknown']);
    expect(button('Herunterladen')?.disabled).toBe(true);

    fake.control.statusError = null;
    const calls = fake.status.mock.calls.length;
    await click(button('Erneut versuchen'));
    expect(fake.status.mock.calls.length).toBeGreaterThan(calls);
    await vi.waitFor(() => expect(rows()).toEqual(['missing']));
    expect(alerts()).toHaveLength(0);
    expect(button('Herunterladen')?.disabled).toBe(false);
  });

  it('shows the check in progress, then offers a new check for files that could not be verified', async () => {
    const fake = fakeModelClient({ states: { [transcriber.id]: 'unverified' } });
    const pending: { fail: (error: Error) => void } = { fail: () => undefined };
    fake.verify.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          pending.fail = reject;
        }),
    );
    await act(async () => {
      root.render(<Harness client={fake.client} roles={['transcriber']} />);
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(rows()).toEqual(['verifying']));
    expect(progressBar()?.getAttribute('aria-valuetext')).toBe('Wird geprüft …');
    expect(progressBar()?.hasAttribute('aria-valuenow')).toBe(false);
    expect(button('Herunterladen')?.disabled).toBe(true);
    expect(fake.verify).toHaveBeenCalledExactlyOnceWith(transcriber.id);

    await act(async () => {
      pending.fail(new ModelCallError({ kind: 'io' }));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(rows()).toEqual(['unverified']));
    expect(alerts()[0]).toContain(
      'Texterkennung: Die vorhandenen Dateien ließen sich nicht prüfen.',
    );
    expect(progressBar()).toBeNull();
    expect(button('Herunterladen')?.disabled).toBe(true);

    await click(button('Erneut versuchen'));
    expect(fake.verify).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(rows()).toEqual(['ready']));
    expect(alerts()).toEqual([]);
  });
});

describe('SetupDialog offline import', () => {
  it('lists file names, sizes and addresses and copies an address to the clipboard', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount({ roles: BOTH });

    const details = container.querySelector('details.setup-offline');
    expect(details?.querySelector('summary')?.textContent).toBe('Aus Datei importieren …');
    expect(details?.hasAttribute('open')).toBe(false);
    const sections = [...(details?.querySelectorAll('section') ?? [])];
    expect(sections.map((section) => section.getAttribute('aria-label'))).toEqual([
      'Texterkennung',
      'Korrektur',
    ]);
    const transcriberFiles = [transcriber.files.model, transcriber.files.mmproj];
    for (const file of transcriberFiles) {
      expect(sections[0]?.textContent).toContain(file.name);
      expect(sections[0]?.textContent).toContain(file.url);
    }
    expect(sections[0]?.textContent).toContain('484 MB');
    expect(sections[1]?.textContent).toContain(corrector.files.model.name);
    expect(sections[1]?.textContent).toContain(corrector.files.model.url);
    expect(sections[1]?.textContent).not.toContain('mmproj');

    const copy = container.querySelector<HTMLButtonElement>(
      `button[aria-label="Adresse von ${transcriber.files.mmproj.name} kopieren"]`,
    );
    expect(copy?.textContent).toBe('Adresse kopieren');
    await click(copy ?? undefined);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(transcriber.files.mmproj.url);
    expect(copy?.textContent).toBe('Kopiert');
  });

  it('imports the selected files per role and reports what could not be used', async () => {
    const fake = await mount({ roles: BOTH });
    const transcriberSection = sectionOf('Texterkennung');
    const correctorSection = sectionOf('Korrektur');

    const pending: { finish: (value: Awaited<ReturnType<ModelClient['importFiles']>>) => void } = {
      finish: () => undefined,
    };
    fake.importFiles.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          pending.finish = resolve;
        }),
    );
    await click(buttonIn(transcriberSection, 'Dateien auswählen …'));
    expect(fake.importFiles).toHaveBeenCalledExactlyOnceWith(transcriber.id);
    const importing = buttonIn(transcriberSection, 'Wird importiert …');
    expect(importing?.disabled).toBe(true);
    expect(buttonIn(correctorSection, 'Dateien auswählen …')?.disabled).toBe(false);

    await act(async () => {
      pending.finish({
        imported: [transcriber.files.model.name],
        unmatched: [{ name: 'extra.gguf', reason: 'unknownFile' }],
      });
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(transcriberSection.querySelector('.setup-note')?.textContent).toBe(
        'Übernommen: 1 von 2 Dateien. Nicht übernommen: extra.gguf (gehört nicht zu diesem Modell).',
      ),
    );
    expect(buttonIn(transcriberSection, 'Dateien auswählen …')?.disabled).toBe(false);

    fake.importFiles.mockImplementationOnce(() => {
      fake.write(corrector.id, 'ready');
      return Promise.resolve({ imported: [corrector.files.model.name], unmatched: [] });
    });
    await click(buttonIn(correctorSection, 'Dateien auswählen …'));
    expect(fake.importFiles).toHaveBeenLastCalledWith(corrector.id);
    await vi.waitFor(() => expect(rows()).toEqual(['missing', 'ready']));
    expect(button('Herunterladen')?.disabled).toBe(false);
  });
});
