// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENGLISCH } from '../annotations/profile.ts';
import { DEFAULT_SCOPE, type CorrectionScope } from '../correction/scope.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import { page, setupReview, waitFor } from '../review/test-support.ts';
import { AppProvider } from './app-context.tsx';
import { Header } from './Header.tsx';
import { testAppModel, testCloud, testWork, type TestAppParts } from './test-app.ts';
import type { RunController, Subject } from './types.ts';

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

const arbeiten: Arbeit[] = [{ id: 'x', name: 'Aufsatz', pages: [page('a'), page('b')] }];

function render(parts: TestAppParts) {
  act(() =>
    root.render(
      <AppProvider value={testAppModel({ importState: { arbeiten }, ...parts })}>
        <Header />
      </AppProvider>,
    ),
  );
}

const button = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (candidate) =>
      candidate.textContent === label || candidate.getAttribute('aria-label') === label,
  );
const labels = () => [...container.querySelectorAll('button')].map((b) => b.textContent);
const subject = () => container.querySelector('select');
const scopeButton = () => container.querySelector<HTMLButtonElement>('.subject-select > button');
const checkbox = (label: string) =>
  [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (input) => input.closest('label')?.textContent === label,
  );

function openScope() {
  click(scopeButton() ?? undefined);
}

function click(element: Element | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error('missing button');
  act(() => element.click());
}

function menuItem(label: string) {
  return [...document.querySelectorAll('[role="menuitem"]')].find(
    (item) => item.textContent === label,
  );
}

describe('Header', () => {
  it('shows only the name and the settings while no Arbeit is loaded', () => {
    const show = vi.fn<() => void>();
    render({
      importState: { arbeiten: [] },
      models: { settings: { open: false, show, close: vi.fn<() => void>() } },
    });
    expect(container.querySelector('.app-title')?.textContent).toBe('Rotstift');
    expect(labels()).toEqual(['']);
    expect(container.querySelector('.preview-tag')).toBeNull();
    click(button('Einstellungen'));
    expect(show).toHaveBeenCalledOnce();
  });

  it('shows the cloud sign only while a step runs remotely and opens the settings', () => {
    render({});
    expect(container.querySelector('.cloud-sign')).toBeNull();
    const show = vi.fn<() => void>();
    const step = {
      template: 'mistral',
      label: 'Mistral AI',
      baseUrl: 'https://api.mistral.ai/v1',
      host: 'api.mistral.ai',
      model: 'mistral-small-latest',
      loopback: false,
      confirmed: true,
      protection: false,
      key: 'system',
    } as const;
    render({
      models: {
        cloud: testCloud({ steps: { transcriber: step } }),
        settings: { open: false, show, close: vi.fn<() => void>() },
      },
    });
    const sign = container.querySelector<HTMLButtonElement>('.cloud-sign');
    expect(sign?.getAttribute('aria-label')).toBe(
      'Texterkennung über Mistral AI, Korrektur lokal, Inhalt und Form lokal',
    );
    click(sign ?? undefined);
    expect(show).toHaveBeenCalledOnce();
  });

  it('names the protection of a remote step in the cloud sign', () => {
    const step = {
      template: 'mistral',
      label: 'Mistral AI',
      baseUrl: 'https://api.mistral.ai/v1',
      host: 'api.mistral.ai',
      model: 'mistral-small-latest',
      loopback: false,
      confirmed: true,
      protection: true,
      key: 'system',
    } as const;
    render({ models: { cloud: testCloud({ steps: { corrector: step } }) } });
    expect(container.querySelector('.cloud-sign')?.getAttribute('aria-label')).toBe(
      'Texterkennung lokal, Korrektur über Mistral AI, pseudonymisiert, Inhalt und Form lokal',
    );
  });

  it('marks the preview mode', () => {
    render({ preview: true });
    expect(container.querySelector('.preview-tag')?.textContent).toBe('Vorschau');
  });

  it('offers the subject and Korrigieren, with word counting behind the arrow', () => {
    const start = vi.fn<RunController['start']>();
    render({ run: { start } });
    expect(scopeButton()?.textContent).toBe('Deutsch');
    expect(subject()).toBeNull();
    openScope();
    expect(subject()?.closest('label')?.textContent).toContain('Fach');
    expect([...(subject()?.options ?? [])].map((option) => option.textContent)).toEqual([
      'Deutsch',
      'Englisch',
      'Französisch',
      'Spanisch',
      'Sachfach',
    ]);
    click(button('Korrigieren'));
    expect(start).toHaveBeenCalledWith();
    click(button('Weitere Möglichkeiten'));
    click(menuItem('Nur Wörter zählen'));
    expect(start).toHaveBeenLastCalledWith('count');
  });

  it('keeps the last chosen kind as the main action', () => {
    const start = vi.fn<RunController['start']>();
    render({ run: { kind: 'count', start } });
    expect(subject()).toBeNull();
    click(button('Wörter zählen'));
    expect(start).toHaveBeenCalledWith();
    click(button('Weitere Möglichkeiten'));
    click(menuItem('Korrigieren'));
    expect(start).toHaveBeenLastCalledWith('correct');
  });

  it('changes the subject', () => {
    const select = vi.fn<Subject['select']>();
    render({ subject: { select } });
    openScope();
    const field = subject();
    if (field === null) throw new Error('missing select');
    act(() => {
      field.value = 'englisch';
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(select).toHaveBeenCalledWith(ENGLISCH);
  });

  it('chooses the kinds and keeps at least one', () => {
    const setScope = vi.fn<Subject['setScope']>();
    render({ subject: { setScope } });
    openScope();
    expect(checkbox('Rechtschreibung')?.checked).toBe(true);
    expect(checkbox('Grammatik')?.checked).toBe(true);
    click(checkbox('Grammatik'));
    expect(setScope).toHaveBeenLastCalledWith({ ...DEFAULT_SCOPE, grammar: false });

    render({ subject: { scope: { ...DEFAULT_SCOPE, grammar: false }, setScope } });
    expect(checkbox('Rechtschreibung')?.disabled).toBe(true);
    expect(checkbox('Grammatik')?.disabled).toBe(false);
  });

  it('takes the assignment and shows it on the button', () => {
    const setScope = vi.fn<Subject['setScope']>();
    render({ subject: { setScope } });
    openScope();
    const field = container.querySelector('textarea');
    if (field === null) throw new Error('missing textarea');
    expect(field.closest('label')?.textContent).toContain('Aufgabenstellung');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        field,
        'Brief an die Großeltern',
      );
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(setScope).toHaveBeenLastCalledWith({
      ...DEFAULT_SCOPE,
      assignment: 'Brief an die Großeltern',
    });

    render({ subject: { scope: { ...DEFAULT_SCOPE, assignment: 'Brief' }, setScope } });
    expect(scopeButton()?.textContent).toBe('Deutsch, mit Aufgabenstellung');
    expect(scopeButton()?.className).not.toContain('btn-primary');
  });

  it('closes the choice with Escape and with a click outside', () => {
    render({});
    openScope();
    const field = subject();
    expect(document.activeElement).toBe(field);
    act(() => {
      field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(subject()).toBeNull();
    expect(document.activeElement).toBe(scopeButton());

    openScope();
    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(subject()).toBeNull();
  });

  it('disables the main action while the models are checked or unavailable', () => {
    render({ run: { checking: true } });
    expect(button('Korrigieren')?.disabled).toBe(true);
    render({ run: { unavailable: 'Die Korrektur steht nur in der Desktop-App zur Verfügung.' } });
    expect(button('Korrigieren')?.disabled).toBe(true);
  });

  it('shows the progress in the middle and offers to cancel while running', () => {
    const cancel = vi.fn<() => void>();
    render({
      run: {
        running: true,
        cancel,
        progress: { label: 'Seite 12 von 61', detail: 'noch etwa 3 Minuten', value: 11, max: 61 },
      },
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Seite 12 von 61noch etwa 3 Minuten',
    );
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('11');
    expect(bar?.getAttribute('aria-valuemax')).toBe('61');
    expect(bar?.getAttribute('aria-valuetext')).toBe('Seite 12 von 61 · noch etwa 3 Minuten');
    expect(button('Korrigieren')).toBeUndefined();
    expect(subject()).toBeNull();
    click(button('Abbrechen'));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('greys out the cancel button while stopping', () => {
    render({
      run: {
        running: true,
        stopping: true,
        progress: { label: 'Wird abgebrochen …', detail: null, value: null, max: 1 },
      },
    });
    expect(button('Abbrechen')?.disabled).toBe(true);
    expect(container.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(
      false,
    );
  });

  it('offers the export once everything is done', () => {
    render({ run: { done: { count: true, correct: true } } });
    expect(button('Exportieren')?.className).toContain('btn-primary');
    expect(button('Korrigieren')).toBeUndefined();
    expect(subject()).toBeNull();
  });

  it('still offers Korrigieren next to the export after counting only', () => {
    const start = vi.fn<RunController['start']>();
    render({ run: { kind: 'count', done: { count: true, correct: false }, start } });
    expect(button('Exportieren')).toBeDefined();
    expect(scopeButton()).not.toBeNull();
    expect(button('Korrigieren')?.className).toContain('btn-secondary');
    click(button('Korrigieren'));
    expect(start).toHaveBeenCalledWith('correct');
  });

  it('runs only for the open pages again when new pages arrive', () => {
    render({ run: { done: { count: false, correct: false } } });
    expect(button('Korrigieren')).toBeDefined();
    expect(button('Exportieren')).toBeUndefined();
  });

  it('keeps the export reachable next to the main action while pages are still open', async () => {
    const { runner, h } = setupReview(['a', 'b']);
    h.transcripts.b = { ok: false, error: { kind: 'failed', message: 'leer' } };
    runner.start();
    await waitFor(() => runner.getState().batch === null);
    render({
      run: { done: { count: false, correct: false } },
      work: testWork({ count: { runner, state: runner.getState() } }),
    });
    expect(button('Exportieren')?.className).toContain('btn-secondary');
    expect(button('Korrigieren')?.className).toContain('btn-primary');
  });
});

function Scoped({ initial }: { initial: CorrectionScope }) {
  const [scope, setScope] = useState(initial);
  return (
    <AppProvider value={testAppModel({ importState: { arbeiten }, subject: { scope, setScope } })}>
      <Header />
    </AppProvider>
  );
}

function renderScoped(initial: CorrectionScope = DEFAULT_SCOPE) {
  act(() => root.render(<Scoped initial={initial} />));
}

const draw = (subjectParts: Partial<Subject>) => {
  render({ subject: subjectParts });
};

const formInput = () =>
  container.querySelector<HTMLInputElement>('.scope-popover input[type="text"]');
const assignmentField = () => container.querySelector<HTMLTextAreaElement>('textarea');
const popover = () => container.querySelector('.scope-popover');
const errors = () =>
  [...container.querySelectorAll('.error-text')].map((element) => element.textContent);

describe('SubjectSelect with content and form', () => {
  it('offers Inhalt and Form next to spelling and grammar, both off by default', () => {
    renderScoped();
    openScope();

    expect(
      [...container.querySelectorAll('.scope-kind')].map((element) => element.textContent),
    ).toEqual(['Rechtschreibung', 'Grammatik', 'Inhalt', 'Form']);
    expect(checkbox('Inhalt')?.checked).toBe(false);
    expect(checkbox('Form')?.checked).toBe(false);
    expect(formInput()).toBeNull();
  });

  it('asks for the Textform when Form is ticked, suggests known forms and focuses the field', () => {
    renderScoped();
    openScope();
    click(checkbox('Form'));

    const input = formInput();
    expect(input?.closest('label')?.textContent).toContain('Textform');
    expect(document.activeElement).toBe(input);
    const list = container.querySelector(
      `datalist#${CSS.escape(input?.getAttribute('list') ?? '')}`,
    );
    const options = [...(list?.querySelectorAll('option') ?? [])].map((option) => option.value);
    expect(options).toContain('Persönlicher Brief');
    expect(new Set(options).size).toBe(options.length);

    click(checkbox('Form'));
    expect(formInput()).toBeNull();
  });

  it('keeps what was typed as the Textform', () => {
    renderScoped();
    openScope();
    click(checkbox('Form'));
    const input = formInput();
    if (input === null) throw new Error('missing input');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'Persönlicher Brief',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(formInput()?.value).toBe('Persönlicher Brief');
  });

  it('moves the focus to the Aufgabenstellung when Inhalt is ticked', () => {
    renderScoped();
    openScope();
    expect(document.activeElement).toBe(subject());

    click(checkbox('Inhalt'));

    expect(checkbox('Inhalt')?.checked).toBe(true);
    expect(document.activeElement).toBe(assignmentField());
  });

  it('does not move the focus when a kind is switched off again', () => {
    renderScoped({ ...DEFAULT_SCOPE, content: true, form: true, formName: 'Bericht' });
    openScope();
    click(checkbox('Inhalt'));
    expect(checkbox('Inhalt')?.checked).toBe(false);
    expect(document.activeElement).not.toBe(assignmentField());
  });

  it('opens on a missing Aufgabenstellung, marks the field, names the problem and focuses it', () => {
    const scope = { ...DEFAULT_SCOPE, content: true };
    draw({ scope, missing: null });
    expect(popover()).toBeNull();

    draw({ scope, missing: 'assignment' });

    const field = assignmentField();
    expect(popover()).not.toBeNull();
    expect(field?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);
    expect(errors()).toEqual(['Aufgabenstellung fehlt']);
    expect(field?.getAttribute('aria-describedby')).toBe(
      container.querySelector('.error-text')?.id,
    );
    expect(field?.closest('label')?.textContent).toContain('Aufgabenstellung fehlt');
  });

  it('opens on a missing Textform and marks that field only', () => {
    const scope = { ...DEFAULT_SCOPE, form: true };
    draw({ scope, missing: null });
    draw({ scope, missing: 'formName' });

    const input = formInput();
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
    expect(errors()).toEqual(['Textform fehlt']);
    expect(assignmentField()?.hasAttribute('aria-invalid')).toBe(false);
  });

  it('flags both fields at once when Textform and Aufgabenstellung are missing', () => {
    const scope = { ...DEFAULT_SCOPE, content: true, form: true };
    draw({ scope, missing: null });
    draw({ scope, missing: 'formName' });

    expect(formInput()?.getAttribute('aria-invalid')).toBe('true');
    expect(assignmentField()?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(formInput());
    expect(errors()).toEqual(['Textform fehlt', 'Aufgabenstellung fehlt']);
  });

  it('opens but flags nothing once the scope no longer needs the field', () => {
    draw({ scope: DEFAULT_SCOPE, missing: null });
    draw({
      scope: { ...DEFAULT_SCOPE, content: true, assignment: 'Beschreibe deinen Tag.' },
      missing: 'assignment',
    });

    expect(popover()).not.toBeNull();
    expect(assignmentField()?.hasAttribute('aria-invalid')).toBe(false);
    expect(errors()).toEqual([]);
  });

  it('forgets the missing field when the choice is closed', () => {
    const clearMissing = vi.fn<() => void>();
    const scope = { ...DEFAULT_SCOPE, content: true };
    draw({ scope, missing: null, clearMissing });
    draw({ scope, missing: 'assignment', clearMissing });
    expect(clearMissing).not.toHaveBeenCalled();

    act(() => {
      assignmentField()?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    expect(popover()).toBeNull();
    expect(clearMissing).toHaveBeenCalled();
    expect(document.activeElement).toBe(scopeButton());
  });
});
