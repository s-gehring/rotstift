// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Menu, MENU_SEPARATOR, SplitButton, type MenuEntry } from './Menu.tsx';

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

function press(key: string, target: Element | null = document.activeElement) {
  if (target === null) throw new Error('nothing focused');
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error('missing element');
  act(() => element.click());
}

const focused = () => document.activeElement?.textContent;
const trigger = () => container.querySelector('[aria-haspopup="menu"]');
const menus = () => [...document.querySelectorAll('[role="menu"]')];
const item = (label: string) =>
  [...document.querySelectorAll('[role="menuitem"]')].find((entry) => entry.textContent === label);

function renderMenu() {
  const rename = vi.fn<() => void>();
  const remove = vi.fn<() => void>();
  const toAnna = vi.fn<() => void>();
  const locked = vi.fn<() => void>();
  const items: MenuEntry[] = [
    { label: 'Umbenennen', onSelect: rename },
    { label: 'Gesperrt', onSelect: locked, disabled: true },
    {
      label: 'Zusammenführen mit',
      items: [
        { label: 'Anna', onSelect: toAnna },
        { label: 'Cleo', onSelect: vi.fn<() => void>() },
      ],
    },
    MENU_SEPARATOR,
    { label: 'Entfernen', onSelect: remove, danger: true },
  ];
  act(() => root.render(<Menu label="Weitere Aktionen für Ben" items={items} />));
  return { rename, remove, toAnna, locked };
}

describe('Menu', () => {
  it('opens from the trigger with the arrow keys and focuses the first or last item', () => {
    renderMenu();
    const button = trigger();
    expect(button?.getAttribute('aria-label')).toBe('Weitere Aktionen für Ben');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    press('ArrowDown', button);
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(menus()[0]?.getAttribute('aria-label')).toBe('Weitere Aktionen für Ben');
    expect(focused()).toBe('Umbenennen');
    press('Escape');
    press('ArrowUp', button);
    expect(focused()).toBe('Entfernen');
  });

  it('moves with the arrow keys, wraps around and jumps with Home and End', () => {
    renderMenu();
    click(trigger());
    expect(focused()).toBe('Umbenennen');
    press('ArrowDown');
    expect(focused()).toBe('Gesperrt');
    press('ArrowDown');
    press('ArrowDown');
    expect(focused()).toBe('Entfernen');
    press('ArrowDown');
    expect(focused()).toBe('Umbenennen');
    press('ArrowUp');
    expect(focused()).toBe('Entfernen');
    press('Home');
    expect(focused()).toBe('Umbenennen');
    press('End');
    expect(focused()).toBe('Entfernen');
  });

  it('jumps to the next item starting with a typed letter', () => {
    renderMenu();
    click(trigger());
    press('e');
    expect(focused()).toBe('Entfernen');
  });

  it('runs an item on Enter, closes and returns the focus to the trigger', () => {
    const { rename } = renderMenu();
    click(trigger());
    press('Enter');
    expect(rename).toHaveBeenCalledOnce();
    expect(menus()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger());
  });

  it('shows disabled items greyed out, focusable but inert', () => {
    const { locked } = renderMenu();
    click(trigger());
    const disabled = item('Gesperrt');
    expect(disabled?.getAttribute('aria-disabled')).toBe('true');
    press('ArrowDown');
    expect(focused()).toBe('Gesperrt');
    press('Enter');
    click(disabled);
    expect(locked).not.toHaveBeenCalled();
    expect(menus()).toHaveLength(1);
  });

  it('opens a submenu with ArrowRight and leaves it with ArrowLeft', () => {
    const { toAnna } = renderMenu();
    click(trigger());
    press('ArrowDown');
    press('ArrowDown');
    const parent = item('Zusammenführen mit');
    expect(parent?.getAttribute('aria-haspopup')).toBe('menu');
    expect(parent?.getAttribute('aria-expanded')).toBe('false');
    press('ArrowRight');
    expect(parent?.getAttribute('aria-expanded')).toBe('true');
    expect(menus()).toHaveLength(2);
    expect(focused()).toBe('Anna');
    press('ArrowDown');
    expect(focused()).toBe('Cleo');
    press('ArrowLeft');
    expect(menus()).toHaveLength(1);
    expect(document.activeElement).toBe(parent);
    press('Enter');
    expect(focused()).toBe('Anna');
    press('Enter');
    expect(toAnna).toHaveBeenCalledOnce();
    expect(menus()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger());
  });

  it('closes only the submenu on Escape and the whole menu on a second Escape', () => {
    renderMenu();
    click(trigger());
    press('End');
    press('ArrowUp');
    press('ArrowRight');
    expect(menus()).toHaveLength(2);
    press('Escape');
    expect(menus()).toHaveLength(1);
    expect(focused()).toBe('Zusammenführen mit');
    press('Escape');
    expect(menus()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger());
  });

  it('keeps Escape from reaching surrounding handlers', () => {
    const outer = vi.fn<() => void>();
    window.addEventListener('keydown', outer);
    renderMenu();
    click(trigger());
    press('Escape');
    window.removeEventListener('keydown', outer);
    expect(outer).not.toHaveBeenCalled();
  });

  it('closes when Tab moves the focus on or when clicking outside', () => {
    renderMenu();
    click(trigger());
    press('Tab');
    expect(menus()).toHaveLength(0);
    click(trigger());
    expect(menus()).toHaveLength(1);
    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(menus()).toHaveLength(0);
  });

  it('toggles with clicks on the trigger', () => {
    renderMenu();
    click(trigger());
    expect(menus()).toHaveLength(1);
    click(trigger());
    expect(menus()).toHaveLength(0);
  });

  it('uses a labelled button as trigger when children are given', () => {
    act(() =>
      root.render(
        <Menu label="Exportieren" items={[{ label: 'Klassen-PDF', onSelect: vi.fn<() => void>() }]}>
          Exportieren
        </Menu>,
      ),
    );
    expect(trigger()?.textContent).toBe('Exportieren');
    expect(trigger()?.hasAttribute('aria-label')).toBe(false);
  });
});

function renderSplit(disabled = false) {
  const main = vi.fn<() => void>();
  const count = vi.fn<() => void>();
  act(() =>
    root.render(
      <SplitButton
        label="Korrigieren"
        menuLabel="Weitere Möglichkeiten"
        disabled={disabled}
        onClick={main}
        items={[{ label: 'Nur Wörter zählen', onSelect: count }]}
      />,
    ),
  );
  const buttons = [...container.querySelectorAll('button')];
  return { main, count, primary: buttons[0], arrow: buttons[1] };
}

describe('SplitButton', () => {
  it('runs the main action from the main part', () => {
    const { main, count, primary } = renderSplit();
    expect(primary?.textContent).toBe('Korrigieren');
    expect(primary?.className).toContain('btn-primary');
    click(primary);
    expect(main).toHaveBeenCalledOnce();
    expect(count).not.toHaveBeenCalled();
    expect(menus()).toHaveLength(0);
  });

  it('offers the alternatives behind the labelled arrow', () => {
    const { main, count, arrow } = renderSplit();
    expect(arrow?.getAttribute('aria-label')).toBe('Weitere Möglichkeiten');
    expect(arrow?.getAttribute('aria-haspopup')).toBe('menu');
    press('ArrowDown', arrow ?? null);
    expect(focused()).toBe('Nur Wörter zählen');
    press('Enter');
    expect(count).toHaveBeenCalledOnce();
    expect(main).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(arrow);
  });

  it('disables both parts together', () => {
    const { primary, arrow } = renderSplit(true);
    expect(primary?.disabled).toBe(true);
    expect(arrow?.disabled).toBe(true);
  });
});
