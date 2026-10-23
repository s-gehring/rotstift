// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testCloud } from '../app/test-app.ts';
import { CloudModelForm } from './CloudModelForm.tsx';
import type { CloudModel, CloudOutcome } from './use-cloud.ts';

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

function render(cloud: CloudModel, onDone = vi.fn<() => void>()) {
  act(() => root.render(<CloudModelForm role="corrector" cloud={cloud} onDone={onDone} />));
  return onDone;
}

function change(element: HTMLInputElement | HTMLSelectElement | null, value: string) {
  if (element === null) throw new Error('missing field');
  const prototype =
    element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

const field = (name: string) =>
  container.querySelector<HTMLInputElement | HTMLSelectElement>(`#cloud-${name}-corrector`);

const button = (label: string) =>
  [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === label);

const protectionSwitch = () => container.querySelector<HTMLInputElement>('input[role="switch"]');

const toggle = () => act(() => protectionSwitch()?.click());

const recognitionField = (name: string) =>
  container.querySelector<HTMLInputElement | HTMLSelectElement>(`#cloud-${name}-transcriber`);

function openRecognition(cloud: CloudModel) {
  act(() =>
    root.render(<CloudModelForm role="transcriber" cloud={cloud} onDone={vi.fn<() => void>()} />),
  );
  change(recognitionField('template'), 'mistral');
  change(recognitionField('key'), 'fake-test-key');
  change(recognitionField('model'), 'pixtral-12b');
}

async function submit() {
  await act(async () => {
    button('Verwenden')?.click();
    await Promise.resolve();
  });
}

async function load() {
  await act(async () => {
    button('Modelle laden')?.click();
    await Promise.resolve();
  });
}

function fill(template: string, address?: string) {
  change(field('template'), template);
  if (address !== undefined) change(field('address'), address);
  change(field('key'), 'fake-test-key');
  change(field('model'), 'mistral-small-latest');
}

function sequence(...outcomes: CloudOutcome[]) {
  return vi.fn<CloudModel['use']>(() => Promise.resolve(outcomes.shift() ?? { state: 'ok' }));
}

describe('CloudModelForm', () => {
  it('asks before the first use and sends nothing when cancelled', async () => {
    const use = sequence({ state: 'consent' });
    const onDone = render(testCloud({ available: true, use }));
    fill('mistral');
    await submit();
    expect(use).toHaveBeenCalledExactlyOnceWith(
      'corrector',
      {
        template: 'mistral',
        baseUrl: 'https://api.mistral.ai/v1',
        model: 'mistral-small-latest',
        key: 'fake-test-key',
        protection: null,
        protectionConfirmed: false,
      },
      false,
    );
    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain('Cloud-Modell verwenden?');
    expect(dialog?.textContent).toContain('Für die Einhaltung der DSGVO');
    expect(dialog?.querySelector('input[type="checkbox"]')).toBeNull();
    expect(document.activeElement?.textContent).toBe('Abbrechen');
    act(() => button('Abbrechen')?.click());
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(use).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('confirms only after Verwenden in the warning', async () => {
    const use = sequence({ state: 'consent' }, { state: 'ok' });
    const onDone = render(testCloud({ available: true, use }));
    fill('mistral');
    await submit();
    await submit();
    expect(use).toHaveBeenLastCalledWith('corrector', expect.anything(), true);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('shows no warning for an own server on this computer', async () => {
    const use = sequence({ state: 'ok' });
    const onDone = render(testCloud({ available: true, use }));
    fill('server', 'http://127.0.0.1:8080/v1');
    await submit();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(use).toHaveBeenCalledExactlyOnceWith(
      'corrector',
      expect.objectContaining({ baseUrl: 'http://127.0.0.1:8080/v1' }),
      false,
    );
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('shows the error next to the field it belongs to', async () => {
    render(testCloud({ available: true, use: sequence({ state: 'error', error: 'auth' }) }));
    fill('mistral');
    await submit();
    const error = field('key')?.nextElementSibling;
    expect(error?.textContent).toBe('Der Anbieter hat den Schlüssel abgelehnt.');
  });

  it('asks for an address only where the provider has none', () => {
    render(testCloud({ available: true }));
    change(field('template'), 'mistral');
    expect(field('address')).toBeNull();
    change(field('template'), 'custom');
    expect(field('address')).not.toBeNull();
    expect(button('Verwenden')?.disabled).toBe(true);
  });

  describe('protection', () => {
    it('starts on for cloud providers and off for an own server and loopback', () => {
      render(testCloud({ available: true }));
      expect(protectionSwitch()).toBeNull();
      change(field('template'), 'mistral');
      expect(protectionSwitch()?.checked).toBe(true);
      expect(container.textContent).toContain('Personenbezug vor dem Senden entfernen');
      change(field('template'), 'server');
      expect(protectionSwitch()?.checked).toBe(false);
      change(field('template'), 'custom');
      expect(protectionSwitch()?.checked).toBe(true);
      change(field('address'), 'http://localhost:8080/v1');
      expect(protectionSwitch()?.checked).toBe(false);
    });

    it('keeps protection on when the warning is cancelled', async () => {
      const use = sequence({ state: 'ok' });
      render(testCloud({ available: true, use }));
      fill('mistral');
      toggle();
      const dialog = container.querySelector('[role="alertdialog"]');
      expect(dialog?.textContent).toContain('Personenbezug nicht entfernen?');
      expect(dialog?.textContent).toContain('Namen und andere persönliche Angaben');
      expect(dialog?.textContent).toContain('Für die Einhaltung der DSGVO');
      expect(dialog?.textContent).not.toContain('Handschrift');
      expect(document.activeElement?.textContent).toBe('Abbrechen');
      act(() => button('Abbrechen')?.click());
      expect(container.querySelector('[role="alertdialog"]')).toBeNull();
      expect(protectionSwitch()?.checked).toBe(true);
      await submit();
      expect(use).toHaveBeenCalledWith(
        'corrector',
        expect.objectContaining({ protection: null, protectionConfirmed: false }),
        false,
      );
    });

    it('sends the confirmed switch-off with the choice', async () => {
      const use = sequence({ state: 'ok' });
      render(testCloud({ available: true, use }));
      fill('mistral');
      toggle();
      act(() => button('Schutz ausschalten')?.click());
      expect(protectionSwitch()?.checked).toBe(false);
      await submit();
      expect(use).toHaveBeenCalledExactlyOnceWith(
        'corrector',
        expect.objectContaining({ protection: false, protectionConfirmed: true }),
        false,
      );
    });

    it('forgets the confirmed switch-off when the provider changes', () => {
      render(testCloud({ available: true }));
      change(field('template'), 'mistral');
      toggle();
      act(() => button('Schutz ausschalten')?.click());
      expect(protectionSwitch()?.checked).toBe(false);
      change(field('template'), 'openai');
      expect(protectionSwitch()?.checked).toBe(true);
    });

    it('needs no warning for an own server', async () => {
      const use = sequence({ state: 'ok' });
      render(testCloud({ available: true, use }));
      fill('server', 'https://ki.schule.example/v1');
      toggle();
      expect(container.querySelector('[role="alertdialog"]')).toBeNull();
      expect(protectionSwitch()?.checked).toBe(true);
      toggle();
      expect(container.querySelector('[role="alertdialog"]')).toBeNull();
      await submit();
      expect(use).toHaveBeenCalledWith(
        'corrector',
        expect.objectContaining({ protection: false, protectionConfirmed: false }),
        false,
      );
    });
  });

  describe('with a provider that lists its models', () => {
    const listed = [
      { id: 'claude-a', displayName: 'Claude A' },
      { id: 'claude-b', displayName: 'claude-b' },
    ];

    it('offers the list without preselecting a model', async () => {
      const models = vi.fn<CloudModel['models']>(() =>
        Promise.resolve({ state: 'ok', models: listed }),
      );
      const use = sequence({ state: 'ok' });
      render(testCloud({ available: true, use, models }));
      change(field('template'), 'anthropic');
      expect(field('model')).toBeNull();
      expect(button('Modelle laden')?.disabled).toBe(true);
      change(field('key'), 'fake-test-key');
      await load();
      expect(models).toHaveBeenCalledExactlyOnceWith({
        template: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        model: '',
        key: 'fake-test-key',
        protection: null,
        protectionConfirmed: false,
      });
      const select = field('model');
      expect(select).toBeInstanceOf(HTMLSelectElement);
      expect(select?.value).toBe('');
      expect([...(select?.querySelectorAll('option') ?? [])].map((o) => o.textContent)).toEqual([
        'Modell wählen',
        'Claude A (claude-a)',
        'claude-b',
      ]);
      expect(button('Verwenden')?.disabled).toBe(true);
      change(select, 'claude-b');
      await submit();
      expect(use).toHaveBeenCalledExactlyOnceWith(
        'corrector',
        expect.objectContaining({ template: 'anthropic', model: 'claude-b' }),
        false,
      );
    });

    it('shows a failed list as an error and keeps the form closed', async () => {
      const models = vi.fn<CloudModel['models']>(() =>
        Promise.resolve({ state: 'error', error: 'auth' }),
      );
      render(testCloud({ available: true, models }));
      change(field('template'), 'anthropic');
      change(field('key'), 'fake-test-key');
      await load();
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        'Der Anbieter hat den Schlüssel abgelehnt.',
      );
      expect(field('model')).toBeNull();
      expect(button('Verwenden')?.disabled).toBe(true);
    });

    it('forgets the list when the provider changes', async () => {
      const models = vi.fn<CloudModel['models']>(() =>
        Promise.resolve({ state: 'ok', models: listed }),
      );
      render(testCloud({ available: true, models }));
      change(field('template'), 'anthropic');
      change(field('key'), 'fake-test-key');
      await load();
      change(field('model'), 'claude-a');
      change(field('template'), 'mistral');
      expect(field('model')).toBeInstanceOf(HTMLInputElement);
      expect(field('model')?.value).toBe('');
    });
  });

  describe('CloudModelForm for the recognition', () => {
    it('cannot be used while protection is on and says why', () => {
      openRecognition(testCloud({ available: true }));
      expect(container.textContent).toContain(
        'Bei eingeschaltetem Schutz läuft die Erkennung lokal.',
      );
      expect(button('Verwenden')?.disabled).toBe(true);
    });

    it('can be used after switching protection off and confirming, naming the handwriting', async () => {
      const use = vi.fn<CloudModel['use']>(() => Promise.resolve({ state: 'ok' }));
      openRecognition(testCloud({ available: true, use }));
      toggle();
      const dialog = container.querySelector('[role="alertdialog"]');
      expect(dialog?.textContent).toContain('Handschrift');
      act(() => button('Abbrechen')?.click());
      expect(button('Verwenden')?.disabled).toBe(true);
      toggle();
      act(() => button('Schutz ausschalten')?.click());
      expect(button('Verwenden')?.disabled).toBe(false);
      await act(async () => {
        button('Verwenden')?.click();
        await Promise.resolve();
      });
      expect(use).toHaveBeenCalledExactlyOnceWith(
        'transcriber',
        expect.objectContaining({ protection: false, protectionConfirmed: true }),
        false,
      );
    });
  });
});
