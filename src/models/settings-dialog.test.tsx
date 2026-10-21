// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProvider } from '../app/app-context.tsx';
import { testAppModel, testCloud, testModelSetup } from '../app/test-app.ts';
import type { Models, ModelRole } from '../app/types.ts';
import { ModelCallError, type ModelClient } from './client.ts';
import {
  defaultCorrector,
  defaultReviewer,
  recommendModel,
  totalBytes,
  type AnyModelInfo,
  type CustomModel,
} from './registry.ts';
import { SettingsDialog } from './SettingsDialog.tsx';
import { fakeModelClient, type FakeClientOptions } from './test-client.ts';
import type { DownloadError, ModelState, ModelStatus, ResolvedLink } from './types.ts';
import {
  useCorrectorModelSetup,
  useModelSetup,
  useReviewerModelSetup,
  type ModelSetup,
} from './use-model-setup.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const transcriber = recommendModel();
const corrector = defaultCorrector();
const reviewer = defaultReviewer();
const GIB = 1024 ** 3;
const QWEN_ID = 'qwen3-vl-4b-q4';
const E4B_ID = 'gemma-4-e4b-q4';
const BIG = { totalRamBytes: 16 * GIB, freeDiskBytes: 100e9 };

const noop = () => undefined;

const statusOf = (model: AnyModelInfo, state: ModelState, downloadedBytes = 0): ModelStatus => ({
  modelId: model.id,
  state,
  downloadedBytes,
  totalBytes: totalBytes(model),
});

const spies = () => ({
  download: vi.fn<ModelSetup['download']>(() => Promise.resolve()),
  remove: vi.fn<ModelSetup['remove']>(() => Promise.resolve()),
  importFiles: vi.fn<ModelSetup['importFiles']>(() => Promise.resolve()),
  verifyAgain: vi.fn<ModelSetup['verifyAgain']>(() => Promise.resolve()),
});

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

function renderModels(models: Partial<Models>, close: () => void = noop, open = true) {
  act(() =>
    root.render(
      <AppProvider
        value={testAppModel({ models: { settings: { open, show: noop, close }, ...models } })}
      >
        <SettingsDialog />
      </AppProvider>,
    ),
  );
}

interface LiveProps {
  readonly client: ModelClient | null;
  readonly switchLocked?: Readonly<Record<ModelRole, boolean>>;
  readonly show?: (roles: readonly ModelRole[]) => void;
  readonly cloud?: Models['cloud'];
}

function Live({
  client,
  switchLocked = { transcriber: false, corrector: false, reviewer: false },
  show = noop,
  cloud = testCloud(),
}: LiveProps) {
  const transcriberSetup = useModelSetup(client);
  const correctorSetup = useCorrectorModelSetup(client);
  const reviewerSetup = useReviewerModelSetup(client);
  return (
    <AppProvider
      value={testAppModel({
        models: {
          transcriber: transcriberSetup,
          corrector: correctorSetup,
          reviewer: reviewerSetup,
          switchLocked,
          cloud,
          settings: { open: true, show: noop, close: noop },
          setup: { open: false, roles: [], pendingRun: null, show, close: noop },
        },
      })}
    >
      <SettingsDialog />
    </AppProvider>
  );
}

const mountLive = async (props: Omit<LiveProps, 'client'>, options: FakeClientOptions = {}) => {
  const fake = fakeModelClient(options);
  await act(async () => {
    root.render(<Live client={fake.client} {...props} />);
    await Promise.resolve();
  });
  await vi.waitFor(() => expect(stateTexts()).not.toContain(''));
  return fake;
};

const section = (role: ModelRole) => {
  const found = container.querySelector<HTMLElement>(`section[aria-labelledby="settings-${role}"]`);
  if (found === null) throw new Error(`no section for ${role}`);
  return found;
};

const activeRow = (parent: ParentNode) =>
  [...parent.querySelectorAll('.settings-model')].find(
    (row) => row.querySelector<HTMLInputElement>('input[type="radio"]')?.checked ?? true,
  );

const stateTexts = () =>
  [...container.querySelectorAll('section')].map(
    (found) => activeRow(found)?.querySelector('.settings-model-state')?.textContent,
  );

const warned = () =>
  [...container.querySelectorAll('.settings-model-need[data-warn]')].map(
    (need) => need.closest('.settings-model')?.querySelector('.settings-model-name')?.textContent,
  );

const buttonLabels = (parent: ParentNode) =>
  [...parent.querySelectorAll('button')].map((el) => el.textContent);

const buttonIn = (parent: ParentNode, label: string) =>
  [...parent.querySelectorAll('button')].find((candidate) => candidate.textContent === label);

const click = (target: HTMLElement | undefined) =>
  act(async () => {
    target?.click();
    await Promise.resolve();
  });

const radios = (parent: ParentNode) => [
  ...parent.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
];

describe('SettingsDialog static content', () => {
  it('shows a section per role with model name, size and state plus the version line', () => {
    renderModels({
      transcriber: testModelSetup(transcriber, statusOf(transcriber, 'ready')),
      corrector: testModelSetup(corrector, statusOf(corrector, 'missing')),
      reviewer: testModelSetup(reviewer, statusOf(reviewer, 'missing')),
    });
    expect(container.querySelector('dialog h2')?.textContent).toBe('Einstellungen');
    expect(section('transcriber').querySelector('h3')?.textContent).toBe('Texterkennung');
    expect(section('corrector').querySelector('h3')?.textContent).toBe('Korrektur');
    expect(section('reviewer').querySelector('h3')?.textContent).toBe('Inhalt und Form');
    expect(section('transcriber').textContent).toContain('GLM-OCR (Q8_0)');
    expect(section('transcriber').textContent).toContain('1,4 GB');
    expect(section('corrector').textContent).toContain('Gemma 4 E2B it (Q4_0)');
    expect(section('corrector').textContent).toContain('2,8 GB');
    expect(section('reviewer').textContent).toContain('Gemma 4 E2B it (Q4_0)');
    expect(stateTexts()).toEqual(['Bereit', 'Nicht eingerichtet', 'Nicht eingerichtet']);
    expect(buttonLabels(section('transcriber'))).toEqual(['Löschen', 'Eigenes Modell …']);
    for (const role of ['corrector', 'reviewer'] as const) {
      expect(buttonLabels(section(role))).toEqual([
        'Herunterladen',
        'Modell aus Datei importieren …',
        'Eigenes Modell …',
      ]);
    }
    expect(container.querySelectorAll('.settings-model-note')).toHaveLength(0);
    expect(section('corrector').textContent).toContain(
      'Wird auch für Inhalt und Form verwendet und nur einmal gespeichert.',
    );
    expect(section('reviewer').textContent).toContain(
      'Wird auch für Korrektur verwendet und nur einmal gespeichert.',
    );
    expect(section('transcriber').textContent).not.toContain('nur einmal gespeichert');
    expect(container.querySelector('summary')?.textContent).toBe('Protokoll');
    expect(container.querySelector('.settings-about')?.textContent).toMatch(
      /^Rotstift \d+\.\d+\.\d+ · Alles bleibt auf diesem Rechner\.$/,
    );
  });

  it('renders no content while closed', () => {
    renderModels({}, noop, false);
    expect(container.querySelector('.dialog-frame')).toBeNull();
  });

  it('closes through the close button', () => {
    const close = vi.fn<() => void>();
    renderModels({}, close);
    act(() => container.querySelector<HTMLElement>('button[aria-label="Schließen"]')?.click());
    expect(close).toHaveBeenCalledOnce();
  });

  it('says models are a desktop feature and hides the sections outside the desktop app', () => {
    renderModels({
      transcriber: testModelSetup(transcriber, null, { available: false }),
      corrector: testModelSetup(corrector, null, { available: false }),
      reviewer: testModelSetup(reviewer, null, { available: false }),
    });
    expect(container.querySelector('.dialog-body')?.textContent).toContain(
      'Modelle gibt es nur in der Desktop-App.',
    );
    expect(container.querySelector('section')).toBeNull();
    expect(container.querySelector('.diagnostics')).toBeNull();
    expect(container.querySelector('.settings-about')).not.toBeNull();
  });

  it('shows a failed operation and the note of the last import', () => {
    const error: DownloadError = { kind: 'network' };
    renderModels({
      transcriber: testModelSetup(transcriber, statusOf(transcriber, 'missing'), { error }),
      corrector: testModelSetup(corrector, statusOf(corrector, 'missing'), {
        state: {
          ...testModelSetup(corrector).state,
          note: 'Übernommen: 1 von 1 Dateien.',
        },
      }),
    });
    expect(section('transcriber').querySelector('[role="alert"]')?.textContent).toContain(
      'Die Verbindung zum Download-Server ist abgebrochen.',
    );
    expect(section('corrector').querySelector('[role="alert"]')).toBeNull();
    expect(section('corrector').querySelector('.settings-note')?.textContent).toBe(
      'Übernommen: 1 von 1 Dateien.',
    );
  });
});

describe('SettingsDialog static actions', () => {
  it('requests the setup for exactly the role whose Herunterladen was clicked', () => {
    const show = vi.fn<(roles: readonly ModelRole[]) => void>();
    renderModels({
      transcriber: testModelSetup(transcriber, statusOf(transcriber, 'missing')),
      corrector: testModelSetup(corrector, statusOf(corrector, 'missing')),
      setup: { open: false, roles: [], pendingRun: null, show, close: noop },
    });
    act(() => buttonIn(section('corrector'), 'Herunterladen')?.click());
    expect(show).toHaveBeenLastCalledWith(['corrector']);
    act(() => buttonIn(section('transcriber'), 'Herunterladen')?.click());
    expect(show).toHaveBeenLastCalledWith(['transcriber']);
    expect(show).toHaveBeenCalledTimes(2);
  });

  it('imports a model from files per role and disables the button while importing', () => {
    const transcriberSpies = spies();
    const correctorSpies = spies();
    const idle = testModelSetup(transcriber, statusOf(transcriber, 'missing'), transcriberSpies);
    renderModels({
      transcriber: idle,
      corrector: testModelSetup(corrector, statusOf(corrector, 'missing'), correctorSpies),
    });
    act(() => buttonIn(section('corrector'), 'Modell aus Datei importieren …')?.click());
    expect(correctorSpies.importFiles).toHaveBeenCalledOnce();
    expect(transcriberSpies.importFiles).not.toHaveBeenCalled();

    renderModels({
      transcriber: {
        ...idle,
        state: { ...idle.state, importing: true },
      },
      corrector: testModelSetup(corrector, statusOf(corrector, 'missing')),
    });
    expect(buttonIn(section('transcriber'), 'Wird importiert …')?.disabled).toBe(true);
    expect(buttonIn(section('transcriber'), 'Modell aus Datei importieren …')).toBeUndefined();
  });

  it('offers to verify unverified files again and still allows a download', () => {
    const verifySpies = spies();
    renderModels({
      transcriber: testModelSetup(
        transcriber,
        statusOf(transcriber, 'unverified', 1_000_000),
        verifySpies,
      ),
    });
    expect(stateTexts()[0]).toBe('Nicht geprüft');
    act(() => buttonIn(section('transcriber'), 'Erneut prüfen')?.click());
    expect(verifySpies.verifyAgain).toHaveBeenCalledOnce();
    expect(buttonIn(section('transcriber'), 'Herunterladen')).toBeDefined();

    renderModels({ transcriber: testModelSetup(transcriber, statusOf(transcriber, 'ready')) });
    expect(buttonIn(section('transcriber'), 'Erneut prüfen')).toBeUndefined();
  });

  it.each(['downloading', 'verifying', 'importing', 'deleting'] as const)(
    'offers no action while the model is %s',
    (state) => {
      renderModels({
        transcriber: testModelSetup(transcriber, statusOf(transcriber, state, 1_000_000)),
      });
      expect(buttonLabels(section('transcriber'))).toEqual(['Eigenes Modell …']);
      expect(buttonIn(section('transcriber'), 'Eigenes Modell …')?.disabled).toBe(true);
    },
  );

  it('lets the user delete a corrupt model and the leftovers of an interrupted download', () => {
    renderModels({
      transcriber: testModelSetup(transcriber, statusOf(transcriber, 'corrupt')),
      corrector: testModelSetup(corrector, statusOf(corrector, 'missing', 300_000_000)),
      reviewer: testModelSetup(reviewer, statusOf(reviewer, 'missing', 300_000_000)),
    });
    expect(stateTexts()).toEqual(['Beschädigt', 'Nicht eingerichtet', 'Nicht eingerichtet']);
    expect(buttonIn(section('transcriber'), 'Löschen')).toBeDefined();
    expect(buttonIn(section('corrector'), 'Löschen')).toBeDefined();
    expect(buttonIn(section('corrector'), 'Herunterladen')).toBeDefined();
  });

  it('deletes only after a confirmation that can be declined', () => {
    const transcriberSpies = spies();
    renderModels({
      transcriber: testModelSetup(transcriber, statusOf(transcriber, 'ready'), transcriberSpies),
      corrector: testModelSetup(corrector, statusOf(corrector, 'ready')),
    });
    act(() => buttonIn(section('transcriber'), 'Löschen')?.click());
    expect(transcriberSpies.remove).not.toHaveBeenCalled();
    const confirm = section('transcriber').querySelector('[role="alertdialog"]');
    expect(confirm?.textContent).toContain('GLM-OCR (Q8_0) wirklich löschen?');
    expect(buttonLabels(confirm ?? container)).toEqual(['Löschen', 'Behalten']);
    expect(document.activeElement?.textContent).toBe('Behalten');
    expect(section('corrector').querySelector('[role="alertdialog"]')).toBeNull();

    act(() => buttonIn(section('transcriber'), 'Behalten')?.click());
    expect(transcriberSpies.remove).not.toHaveBeenCalled();
    expect(section('transcriber').querySelector('[role="alertdialog"]')).toBeNull();

    act(() => buttonIn(section('transcriber'), 'Löschen')?.click());
    act(() =>
      buttonIn(
        section('transcriber').querySelector('[role="alertdialog"]') ?? container,
        'Löschen',
      )?.click(),
    );
    expect(transcriberSpies.remove).toHaveBeenCalledOnce();
    expect(section('transcriber').querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('keeps the delete button disabled for a locked role only', () => {
    renderModels({
      transcriber: testModelSetup(transcriber, statusOf(transcriber, 'ready')),
      corrector: testModelSetup(corrector, statusOf(corrector, 'ready')),
      switchLocked: { transcriber: true, corrector: false, reviewer: false },
    });
    expect(buttonIn(section('transcriber'), 'Löschen')?.disabled).toBe(true);
    expect(buttonIn(section('corrector'), 'Löschen')?.disabled).toBe(false);
  });
});

describe('SettingsDialog with live model state', () => {
  it('offers every model of each step with its memory need and switches', async () => {
    const fake = await mountLive({}, { hardware: BIG, states: { [transcriber.id]: 'ready' } });
    for (const role of ['transcriber', 'corrector', 'reviewer'] as const) {
      await vi.waitFor(() => expect(radios(section(role))).toHaveLength(2));
    }
    expect(radios(section('transcriber')).map((radio) => radio.checked)).toEqual([true, false]);
    const text = section('transcriber').querySelector('.model-choice')?.textContent ?? '';
    expect(text).toContain('GLM-OCR (Q8_0)');
    expect(text).toContain('Qwen3-VL 4B Instruct (Q4_K_M)');
    expect(text).toContain('3,0 GB');
    expect(text).toContain('braucht etwa 5,7 GB');
    expect(section('corrector').textContent).toContain('Gemma 4 E4B it (Q4_0)');
    expect(section('corrector').textContent).toContain('braucht etwa 7,6 GB');
    expect(container.querySelectorAll('.settings-model-note')).toHaveLength(0);
    expect(warned()).toEqual([]);

    await click(radios(section('transcriber'))[1]);
    expect(fake.select).toHaveBeenCalledExactlyOnceWith(QWEN_ID);
    await vi.waitFor(() =>
      expect(radios(section('transcriber')).map((radio) => radio.checked)).toEqual([false, true]),
    );
    expect(
      activeRow(section('transcriber'))?.querySelector('.settings-model-name')?.textContent,
    ).toBe('Qwen3-VL 4B Instruct (Q4_K_M)');
    expect(stateTexts()[0]).toBe('Nicht eingerichtet');

    await click(radios(section('corrector'))[1]);
    expect(fake.selectCorrector).toHaveBeenCalledExactlyOnceWith(E4B_ID);
    expect(fake.selectReviewer).not.toHaveBeenCalled();
  });

  it('shows a cloud step in place of the local choice and switches back on request', async () => {
    const clear = vi.fn<Models['cloud']['clear']>(() => Promise.resolve());
    const cloud = testCloud({
      available: true,
      clear,
      steps: {
        corrector: {
          template: 'server',
          label: '127.0.0.1',
          baseUrl: 'http://127.0.0.1:8080/v1',
          host: '127.0.0.1',
          model: 'gemma',
          loopback: true,
          confirmed: true,
          key: null,
        },
      },
    });
    const fake = await mountLive({ cloud }, { hardware: BIG });
    await vi.waitFor(() => expect(radios(section('corrector'))).toHaveLength(3));
    expect(radios(section('corrector')).map((radio) => radio.checked)).toEqual([
      true,
      false,
      false,
    ]);
    expect(section('corrector').textContent).toContain('Eigener Server');
    expect(section('corrector').querySelector('.cloud-model-key')).toBeNull();
    expect(container.textContent).toContain('Alles bleibt auf diesem Rechner.');

    await click(radios(section('corrector'))[2]);
    expect(clear).toHaveBeenCalledExactlyOnceWith('corrector');
    await vi.waitFor(() => expect(fake.selectCorrector).toHaveBeenCalledExactlyOnceWith(E4B_ID));
  });

  it('offers a cloud model per step only in the desktop app', async () => {
    await mountLive({ cloud: testCloud({ available: true }) }, { hardware: BIG });
    const add = [...section('reviewer').querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Cloud-Modell …',
    );
    await click(add);
    expect(section('reviewer').querySelector('form.cloud-model')).not.toBeNull();
    expect(section('transcriber').querySelector('form.cloud-model')).toBeNull();
  });

  it('lists every model of a choice once with size, state and Löschen', async () => {
    const fake = await mountLive(
      {},
      { hardware: BIG, states: { [transcriber.id]: 'ready', [QWEN_ID]: 'ready' } },
    );
    await vi.waitFor(() => expect(radios(section('transcriber'))).toHaveLength(2));
    const rows = [...section('transcriber').querySelectorAll('.settings-model')];
    expect(rows.map((row) => row.querySelector('.settings-model-name')?.textContent)).toEqual([
      'GLM-OCR (Q8_0)',
      'Qwen3-VL 4B Instruct (Q4_K_M)',
    ]);
    expect(rows.map((row) => row.querySelector('.settings-model-state')?.textContent)).toEqual([
      'Bereit',
      'Bereit',
    ]);
    expect(rows.map((row) => buttonLabels(row))).toEqual([['Löschen'], ['Löschen']]);
    expect(section('transcriber').textContent.match(/GLM-OCR/g)).toHaveLength(1);

    await click(buttonIn(rows[1] ?? container, 'Löschen'));
    expect(section('transcriber').textContent).toContain(
      'Qwen3-VL 4B Instruct (Q4_K_M) wirklich löschen?',
    );
    await click(
      buttonIn(
        section('transcriber').querySelector('[role="alertdialog"]') ?? container,
        'Löschen',
      ),
    );
    expect(fake.remove).toHaveBeenCalledExactlyOnceWith(QWEN_ID);
  });

  it('marks the models that exceed the memory of an 8 GB machine', async () => {
    await mountLive(
      {},
      {
        hardware: { totalRamBytes: 8 * GIB, freeDiskBytes: 100e9 },
        states: { [transcriber.id]: 'ready' },
      },
    );
    await vi.waitFor(() => expect(radios(section('corrector'))).toHaveLength(2));
    expect(warned()).toEqual([
      'Qwen3-VL 4B Instruct (Q4_K_M)',
      'Gemma 4 E4B it (Q4_0)',
      'Gemma 4 E4B it (Q4_0)',
    ]);
    expect(section('corrector').textContent).toContain('braucht etwa 5,5 GB');
  });

  it('marks nothing with unknown memory', async () => {
    await mountLive({}, { hardware: null, states: { [transcriber.id]: 'ready' } });
    await vi.waitFor(() => expect(radios(section('corrector'))).toHaveLength(2));
    expect(warned()).toEqual([]);
  });

  it('blocks switching while another model is being handled', async () => {
    await mountLive({}, { hardware: BIG, states: { [QWEN_ID]: 'downloading' } });
    await vi.waitFor(() => expect(radios(section('transcriber'))).toHaveLength(2));
    expect(container.querySelector('fieldset')?.disabled).toBe(true);
  });

  it('blocks switching and deleting for a locked role', async () => {
    await mountLive(
      { switchLocked: { transcriber: true, corrector: false, reviewer: false } },
      { hardware: BIG, states: { [transcriber.id]: 'ready', [corrector.id]: 'ready' } },
    );
    await vi.waitFor(() => expect(radios(section('transcriber'))).toHaveLength(2));
    expect(section('transcriber').querySelector('fieldset')?.disabled).toBe(true);
    expect(buttonIn(section('transcriber'), 'Löschen')?.disabled).toBe(true);
    expect(buttonIn(section('corrector'), 'Löschen')?.disabled).toBe(false);
  });

  it('deletes a model only after confirmation and then offers to set it up again', async () => {
    const show = vi.fn<(roles: readonly ModelRole[]) => void>();
    const fake = await mountLive(
      { show },
      { states: { [transcriber.id]: 'ready', [corrector.id]: 'ready' } },
    );
    expect(stateTexts()).toEqual(['Bereit', 'Bereit', 'Bereit']);

    await click(buttonIn(section('corrector'), 'Löschen'));
    expect(section('corrector').textContent).toContain('Gemma 4 E2B it (Q4_0) wirklich löschen?');
    await click(buttonIn(section('corrector'), 'Behalten'));
    expect(fake.remove).not.toHaveBeenCalled();
    expect(stateTexts()).toEqual(['Bereit', 'Bereit', 'Bereit']);

    await click(buttonIn(section('corrector'), 'Löschen'));
    await click(
      buttonIn(section('corrector').querySelector('[role="alertdialog"]') ?? container, 'Löschen'),
    );
    expect(fake.remove).toHaveBeenCalledExactlyOnceWith(corrector.id);
    await vi.waitFor(() =>
      expect(stateTexts()).toEqual(['Bereit', 'Nicht eingerichtet', 'Nicht eingerichtet']),
    );
    expect(buttonLabels(section('corrector'))).toEqual([
      'Herunterladen',
      'Modell aus Datei importieren …',
      'Eigenes Modell …',
    ]);
    expect(buttonLabels(section('transcriber'))).toEqual(['Löschen', 'Eigenes Modell …']);

    await click(buttonIn(section('corrector'), 'Herunterladen'));
    expect(show).toHaveBeenCalledExactlyOnceWith(['corrector']);
  });

  it('deleting the shared model from the reviewer section removes it for the corrector too', async () => {
    const show = vi.fn<(roles: readonly ModelRole[]) => void>();
    const fake = await mountLive({ show }, { states: { [corrector.id]: 'ready' } });
    await vi.waitFor(() =>
      expect(stateTexts()).toEqual(['Nicht eingerichtet', 'Bereit', 'Bereit']),
    );

    await click(buttonIn(section('reviewer'), 'Löschen'));
    expect(section('reviewer').textContent).toContain('Gemma 4 E2B it (Q4_0) wirklich löschen?');
    await click(
      buttonIn(section('reviewer').querySelector('[role="alertdialog"]') ?? container, 'Löschen'),
    );
    expect(fake.remove).toHaveBeenCalledExactlyOnceWith(reviewer.id);
    await vi.waitFor(() =>
      expect(stateTexts()).toEqual([
        'Nicht eingerichtet',
        'Nicht eingerichtet',
        'Nicht eingerichtet',
      ]),
    );

    await click(buttonIn(section('reviewer'), 'Herunterladen'));
    expect(show).toHaveBeenCalledExactlyOnceWith(['reviewer']);
  });

  it('locks the reviewer section on its own', async () => {
    await mountLive(
      { switchLocked: { transcriber: false, corrector: false, reviewer: true } },
      { states: { [corrector.id]: 'ready' } },
    );
    await vi.waitFor(() =>
      expect(stateTexts()).toEqual(['Nicht eingerichtet', 'Bereit', 'Bereit']),
    );
    expect(section('reviewer').querySelector('fieldset')?.disabled).toBe(true);
    expect(buttonIn(section('reviewer'), 'Löschen')?.disabled).toBe(true);
    expect(buttonIn(section('corrector'), 'Löschen')?.disabled).toBe(false);
  });

  it('verifies leftover files again on request and shows the verified result', async () => {
    const fake = fakeModelClient({ states: { [transcriber.id]: 'unverified' } });
    const failure = new Error('verify failed');
    fake.verify.mockImplementationOnce(() => Promise.reject(failure));
    await act(async () => {
      root.render(<Live client={fake.client} />);
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(stateTexts()[0]).toBe('Nicht geprüft'));
    expect(fake.verify).toHaveBeenCalledOnce();

    await click(buttonIn(section('transcriber'), 'Erneut prüfen'));
    expect(fake.verify).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(stateTexts()[0]).toBe('Bereit'));
    expect(buttonIn(section('transcriber'), 'Erneut prüfen')).toBeUndefined();
  });

  it('shows no sections without a client', async () => {
    await act(async () => {
      root.render(<Live client={null} />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Modelle gibt es nur in der Desktop-App.');
    expect(container.querySelector('section')).toBeNull();
  });
});

const COMMIT = 'a'.repeat(40);

const linked: CustomModel = {
  id: 'custom-0123456789ab',
  role: 'corrector',
  source: { kind: 'huggingFace', repo: 'owner/small-GGUF', revision: COMMIT },
  files: {
    model: {
      name: 'small-Q4_K_M.gguf',
      url: `https://huggingface.co/owner/small-GGUF/resolve/${COMMIT}/small-Q4_K_M.gguf`,
      sha256: 'b'.repeat(64),
      bytes: 1_500_000_000,
    },
    mmproj: null,
  },
};

const fromFile: CustomModel = {
  id: 'custom-ba9876543210',
  role: 'corrector',
  source: { kind: 'file' },
  files: {
    model: { name: 'own.gguf', url: '', sha256: 'c'.repeat(64), bytes: 2_000_000_000 },
    mmproj: null,
  },
};

const resolvedLink: ResolvedLink = {
  repo: 'owner/small-GGUF',
  commit: COMMIT,
  models: [
    { path: 'small-Q4_K_M.gguf', bytes: 1_500_000_000, sha256: 'b'.repeat(64) },
    { path: 'small-Q8_0.gguf', bytes: 2_600_000_000, sha256: 'd'.repeat(64) },
  ],
  projectors: [],
  model: 'small-Q4_K_M.gguf',
  projector: null,
};

const typeInto = (input: HTMLInputElement | null, value: string) =>
  act(() => {
    if (input === null) throw new Error('no input');
    Reflect.set(HTMLInputElement.prototype, 'value', value, input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('SettingsDialog with a custom model', () => {
  it('adds a model from a Hugging Face link, downloads it for this step and probes it', async () => {
    const fake = await mountLive(
      {},
      { hardware: BIG, states: { [transcriber.id]: 'ready', [corrector.id]: 'ready' } },
    );
    fake.resolveLink.mockResolvedValueOnce(resolvedLink);
    fake.addLink.mockImplementationOnce(() => Promise.resolve(fake.addCustom(linked)));

    await click(buttonIn(section('corrector'), 'Eigenes Modell …'));
    expect(buttonIn(section('corrector'), 'Prüfen')?.disabled).toBe(true);
    typeInto(
      section('corrector').querySelector('input[type="text"]'),
      'https://huggingface.co/owner/small-GGUF',
    );
    await click(buttonIn(section('corrector'), 'Prüfen'));
    expect(fake.resolveLink).toHaveBeenCalledExactlyOnceWith(
      'https://huggingface.co/owner/small-GGUF',
    );
    await vi.waitFor(() =>
      expect(buttonIn(section('corrector'), 'Hinzufügen und laden')).toBeDefined(),
    );
    const options = [...section('corrector').querySelectorAll('option')].map(
      (option) => option.value,
    );
    expect(options).toEqual(['small-Q4_K_M.gguf', 'small-Q8_0.gguf']);
    expect(section('corrector').textContent).toContain('owner/small-GGUF · 1,5 GB');

    await click(buttonIn(section('corrector'), 'Hinzufügen und laden'));
    expect(fake.addLink).toHaveBeenCalledExactlyOnceWith(
      'corrector',
      'owner/small-GGUF',
      COMMIT,
      'small-Q4_K_M.gguf',
      null,
    );
    await vi.waitFor(() => expect(fake.startDownload).toHaveBeenCalledWith(linked.id));
    expect(fake.selectCorrector).toHaveBeenLastCalledWith(linked.id);
    expect(fake.selectReviewer).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(radios(section('reviewer'))).toHaveLength(3));
    expect(
      activeRow(section('corrector'))?.querySelector('.settings-model-name')?.textContent,
    ).toBe('small-Q4_K_M.gguf');
    expect(activeRow(section('corrector'))?.textContent).toContain('owner/small-GGUF');

    expect(fake.probe).not.toHaveBeenCalled();
    await act(async () => {
      fake.dispatch({ modelId: linked.id, state: 'done' });
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(fake.probe).toHaveBeenCalledExactlyOnceWith(linked.id));
  });

  it('shows a failed link check at the step', async () => {
    const fake = await mountLive({}, { hardware: BIG, states: { [corrector.id]: 'ready' } });
    fake.resolveLink.mockRejectedValueOnce(
      new ModelCallError({ kind: 'custom', detail: { reason: 'gated' } }),
    );
    await click(buttonIn(section('reviewer'), 'Eigenes Modell …'));
    typeInto(section('reviewer').querySelector('input[type="text"]'), 'https://hf.co/a/b');
    await click(buttonIn(section('reviewer'), 'Prüfen'));
    await vi.waitFor(() =>
      expect(section('reviewer').querySelector('[role="alert"]')?.textContent).toContain(
        'Dieses Modell verlangt eine Anmeldung bei Hugging Face.',
      ),
    );
    expect(section('corrector').querySelector('[role="alert"]')).toBeNull();
    expect(buttonIn(section('reviewer'), 'Hinzufügen und laden')).toBeUndefined();
  });

  it('imports a model from a file, reports what the runtime cannot load and goes back', async () => {
    const fake = await mountLive(
      {},
      { hardware: BIG, states: { [corrector.id]: 'ready', [fromFile.id]: 'ready' } },
    );
    fake.importCustom.mockImplementationOnce(() => Promise.resolve(fake.addCustom(fromFile)));
    fake.probe.mockResolvedValueOnce({
      kind: 'exitedDuringStartup',
      detail: { code: 1, log: "error: unknown model architecture: 'granitehybrid'" },
    });

    await click(buttonIn(section('reviewer'), 'Eigenes Modell …'));
    await click(buttonIn(section('reviewer'), 'Datei wählen …'));
    expect(fake.importCustom).toHaveBeenCalledExactlyOnceWith('corrector');
    await vi.waitFor(() => expect(fake.probe).toHaveBeenCalledExactlyOnceWith(fromFile.id));
    expect(fake.startDownload).not.toHaveBeenCalled();
    expect(fake.selectReviewer).toHaveBeenLastCalledWith(fromFile.id);
    const alert = () => section('reviewer').querySelector('[role="alert"]');
    await vi.waitFor(() =>
      expect(alert()?.textContent).toContain(
        'Dieses Modell kennt die eingebaute Laufzeit nicht (Architektur granitehybrid).',
      ),
    );
    expect(activeRow(section('reviewer'))?.textContent).toContain('Eigene Datei');
    expect(buttonIn(section('reviewer'), 'Herunterladen')).toBeUndefined();

    await click(buttonIn(alert() ?? container, 'Empfohlenes Modell nutzen'));
    expect(fake.selectReviewer).toHaveBeenLastCalledWith(reviewer.id);
    await vi.waitFor(() =>
      expect(
        activeRow(section('reviewer'))?.querySelector('.settings-model-name')?.textContent,
      ).toBe('Gemma 4 E2B it (Q4_0)'),
    );
    expect(alert()).toBeNull();
  });
});
