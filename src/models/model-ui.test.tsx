// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelManagement } from './ModelManagement.tsx';
import { ModelSetupDialog, progressMilestone } from './ModelSetupDialog.tsx';
import { recommendModel } from './registry.ts';
import { INITIAL_SETUP, type SetupState } from './setup-state.ts';
import type { ModelSetup } from './use-model-setup.ts';
import type { ModelState } from './types.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const model = recommendModel(null);
const GIB = 1024 ** 3;

function fakeSetup(state: ModelState, downloaded = 0, extra: Partial<SetupState> = {}): ModelSetup {
  const total = model.files.model.bytes + model.files.mmproj.bytes;
  return {
    available: true,
    state: { ...INITIAL_SETUP, loaded: true, ...extra },
    model,
    status: { modelId: model.id, state, downloadedBytes: downloaded, totalBytes: total },
    download: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    cancel: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    remove: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    importFiles: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    refresh: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    verifyAgain: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    clearError: vi.fn<() => void>(),
  };
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

const button = (label: string) =>
  [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent.startsWith(label),
  );

function renderDialog(setup: ModelSetup) {
  act(() => root.render(<ModelSetupDialog setup={setup} open={false} onClose={() => undefined} />));
}

describe('ModelSetupDialog', () => {
  it('states size, source and the privacy promise before the download', () => {
    const setup = fakeSetup('missing');
    renderDialog(setup);
    const text = container.textContent;
    expect(text).toContain('1,6 GB');
    expect(text).toContain('huggingface.co');
    expect(text).toContain('Einmaliger Download, danach komplett offline.');
    expect(text).toContain('Es werden keine Schülerdaten übertragen.');
    act(() => button('Herunterladen')?.click());
    expect(setup.download).toHaveBeenCalledOnce();
    act(() => button('Modell aus Datei importieren')?.click());
    expect(setup.importFiles).toHaveBeenCalledOnce();
  });

  it('warns on machines with less than 8 GB memory', () => {
    renderDialog(
      fakeSetup('missing', 0, { hardware: { totalRamBytes: 4 * GIB, freeDiskBytes: 50 * GIB } }),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('nur 4,0 GB');
    renderDialog(
      fakeSetup('missing', 0, { hardware: { totalRamBytes: 16 * GIB, freeDiskBytes: 50 * GIB } }),
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows progress in MB and offers to cancel while downloading', () => {
    const setup = fakeSetup('downloading', 412_000_000);
    renderDialog(setup);
    expect(container.textContent).toContain('412 MB von 1.552 MB');
    expect(container.textContent).toContain('Restzeit wird geschätzt');
    expect(button('Herunterladen')).toBeUndefined();
    act(() => button('Download abbrechen')?.click());
    expect(setup.cancel).toHaveBeenCalledOnce();
  });

  it('announces progress to screen readers only at milestones', () => {
    renderDialog(fakeSetup('downloading', 412_000_000));
    const bar = container.querySelector('progress');
    expect(bar?.getAttribute('aria-label')).toBe('Download-Fortschritt');
    expect(bar?.getAttribute('aria-valuetext')).toBe('412 MB von 1.552 MB');
    const live = () => container.querySelectorAll('[role="status"]');
    expect(live()).toHaveLength(1);
    expect(live()[0]?.textContent).toBe('Download zu 20 Prozent geladen');
    expect(live()[0]?.textContent).not.toContain('MB');

    renderDialog(fakeSetup('downloading', 430_000_000));
    expect(container.querySelector('progress')?.getAttribute('aria-valuetext')).toBe(
      '430 MB von 1.552 MB',
    );
    expect(container.textContent).toContain('430 MB von 1.552 MB');
    expect(live()[0]?.textContent).toBe('Download zu 20 Prozent geladen');

    renderDialog(fakeSetup('downloading', 470_000_000));
    expect(live()[0]?.textContent).toBe('Download zu 30 Prozent geladen');
  });

  it('computes progress milestones in steps of ten percent', () => {
    expect(progressMilestone(0, 1000)).toBe(0);
    expect(progressMilestone(99, 1000)).toBe(0);
    expect(progressMilestone(100, 1000)).toBe(10);
    expect(progressMilestone(999, 1000)).toBe(90);
    expect(progressMilestone(1000, 1000)).toBe(100);
    expect(progressMilestone(5, 0)).toBe(0);
  });

  it('explains how to set up without internet and lets the user copy the addresses', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderDialog(fakeSetup('missing'));
    const details = container.querySelector('details.offline-setup');
    expect(details?.querySelector('summary')?.textContent).toBe('Ohne Internet einrichten');
    for (const file of [model.files.model, model.files.mmproj]) {
      expect(details?.textContent).toContain(file.name);
      expect(details?.textContent).toContain(file.url);
    }
    expect(details?.textContent).toContain('445 MB');

    const copy = container.querySelector<HTMLButtonElement>(
      `button[aria-label="Adresse von ${model.files.mmproj.name} kopieren"]`,
    );
    await act(async () => {
      copy?.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(model.files.mmproj.url);
    expect(copy?.textContent).toBe('Kopiert');
  });

  it('hides the offline help while downloading and when ready', () => {
    renderDialog(fakeSetup('downloading', 1000));
    expect(container.querySelector('.offline-setup')).toBeNull();
    renderDialog(fakeSetup('ready', 1_552_000_000));
    expect(container.querySelector('.offline-setup')).toBeNull();
  });

  it('shows a check in progress instead of the download buttons', () => {
    renderDialog(fakeSetup('verifying', 1_552_000_000));
    expect(container.textContent).toContain('werden geprüft');
    expect(button('Herunterladen')).toBeUndefined();
    expect(button('Download fortsetzen')).toBeUndefined();
    expect(button('Modell aus Datei importieren')).toBeUndefined();
    expect(button('Erneut prüfen')).toBeUndefined();
  });

  it('offers to check again when the files could not be checked', () => {
    const setup = fakeSetup('unverified', 1_552_000_000);
    renderDialog(setup);
    expect(container.textContent).toContain('konnten nicht geprüft werden');
    act(() => button('Erneut prüfen')?.click());
    expect(setup.verifyAgain).toHaveBeenCalledOnce();
    expect(button('Herunterladen')).toBeDefined();
  });

  it('says what is going on while the files are imported or deleted', () => {
    renderDialog(fakeSetup('importing', 0));
    expect(container.textContent).toContain('gerade importiert');
    expect(button('Herunterladen')).toBeUndefined();
    renderDialog(fakeSetup('deleting', 0));
    expect(container.textContent).toContain('gerade gelöscht');
    expect(button('Herunterladen')).toBeUndefined();
    expect(button('Modell aus Datei importieren')).toBeUndefined();
  });

  it('resumes partial downloads and shows understandable errors', () => {
    renderDialog(fakeSetup('missing', 300_000_000, { error: { kind: 'network', detail: 'x' } }));
    expect(button('Download fortsetzen')).toBeDefined();
    expect(container.querySelector('.error-text')?.textContent).toContain('Internetverbindung');
  });

  it('confirms when the model is ready', () => {
    renderDialog(fakeSetup('ready', 1_552_000_000));
    expect(container.textContent).toContain('Die Texterkennung ist eingerichtet.');
    expect(button('Herunterladen')).toBeUndefined();
  });
});

describe('ModelManagement', () => {
  it('deletes the model only after a confirmation', () => {
    const setup = fakeSetup('ready', 1_552_000_000);
    act(() =>
      root.render(<ModelManagement setup={setup} onSetup={() => undefined} disabled={false} />),
    );
    act(() => button('Modell löschen')?.click());
    expect(setup.remove).not.toHaveBeenCalled();
    expect(container.textContent).toContain('wirklich löschen');
    act(() => button('Behalten')?.click());
    expect(setup.remove).not.toHaveBeenCalled();
    act(() => button('Modell löschen')?.click());
    act(() => button('Modell löschen')?.click());
    expect(setup.remove).toHaveBeenCalledOnce();
  });

  it('offers to check again and hides the delete button while busy', () => {
    const setup = fakeSetup('unverified', 1_552_000_000);
    act(() =>
      root.render(<ModelManagement setup={setup} onSetup={() => undefined} disabled={false} />),
    );
    expect(container.textContent).toContain('Noch nicht geprüft');
    act(() => button('Erneut prüfen')?.click());
    expect(setup.verifyAgain).toHaveBeenCalledOnce();
    for (const state of ['importing', 'deleting', 'verifying'] as const) {
      act(() =>
        root.render(
          <ModelManagement
            setup={fakeSetup(state, 1000)}
            onSetup={() => undefined}
            disabled={false}
          />,
        ),
      );
      expect(button('Modell löschen')).toBeUndefined();
    }
  });

  it('is hidden outside the desktop app and offers the setup when missing', () => {
    const onSetup = vi.fn<() => void>();
    act(() =>
      root.render(
        <ModelManagement
          setup={{ ...fakeSetup('missing'), available: false }}
          onSetup={onSetup}
          disabled={false}
        />,
      ),
    );
    expect(container.textContent).toBe('');
    act(() =>
      root.render(
        <ModelManagement setup={fakeSetup('missing')} onSetup={onSetup} disabled={false} />,
      ),
    );
    expect(button('Modell löschen')).toBeUndefined();
    act(() => button('Texterkennung einrichten')?.click());
    expect(onSetup).toHaveBeenCalledOnce();
  });
});
