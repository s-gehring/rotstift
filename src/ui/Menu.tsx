import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Button, type ButtonVariant } from './Button.tsx';
import { classNames } from './class-names.ts';
import { IconButton } from './IconButton.tsx';
import { Icon, type IconName } from './icons.tsx';

export interface MenuAction {
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  readonly icon?: IconName;
  readonly danger?: boolean;
}

export interface MenuSubmenu {
  readonly label: string;
  readonly items: readonly MenuEntry[];
  readonly disabled?: boolean;
  readonly icon?: IconName;
}

export interface MenuSeparator {
  readonly separator: true;
}

export type MenuEntry = MenuAction | MenuSubmenu | MenuSeparator;

export const MENU_SEPARATOR: MenuSeparator = { separator: true };

type InitialFocus = 'first' | 'last';

function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return 'separator' in entry;
}

function isSubmenu(entry: MenuEntry): entry is MenuSubmenu {
  return 'items' in entry;
}

function buttonPositions(items: readonly MenuEntry[]): number[] {
  const positions: number[] = [];
  let next = 0;
  for (const entry of items) {
    positions.push(isSeparator(entry) ? -1 : next);
    if (!isSeparator(entry)) next += 1;
  }
  return positions;
}

function menuButtons(list: HTMLUListElement | null): HTMLButtonElement[] {
  if (list === null) return [];
  return [...list.children].flatMap((item) => {
    const button = item.firstElementChild;
    return button instanceof HTMLButtonElement ? [button] : [];
  });
}

interface MenuListProps {
  readonly id?: string;
  readonly label: string;
  readonly items: readonly MenuEntry[];
  readonly initialFocus: InitialFocus;
  readonly onSelect: (action: MenuAction) => void;
  readonly onClose: () => void;
  readonly onCloseAll: () => void;
  readonly nested?: boolean;
  readonly className?: string;
}

function MenuList({
  id,
  nested = false,
  label,
  items,
  initialFocus,
  onSelect,
  onClose,
  onCloseAll,
  className,
}: MenuListProps) {
  const list = useRef<HTMLUListElement>(null);
  const [submenu, setSubmenu] = useState<{ index: number; focus: InitialFocus } | null>(null);
  const [flip, setFlip] = useState({ x: false, y: false });

  const buttons = () => menuButtons(list.current);
  const focusAt = (index: number) => {
    const all = buttons();
    if (all.length === 0) return;
    all[(index + all.length) % all.length]?.focus();
  };
  const currentIndex = () => buttons().findIndex((button) => button === document.activeElement);
  const entryIndex = (button: number) => {
    let seen = -1;
    return items.findIndex((entry) => !isSeparator(entry) && ++seen === button);
  };

  useLayoutEffect(() => {
    const rect = list.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setFlip({
      x: rect.right > window.innerWidth - 8 && rect.width > 0,
      y: rect.bottom > window.innerHeight - 8 && rect.height > 0,
    });
  }, [list]);

  useEffect(() => {
    const all = menuButtons(list.current);
    all[initialFocus === 'first' ? 0 : all.length - 1]?.focus();
  }, [list, initialFocus]);

  const openSubmenu = (index: number, focus: InitialFocus) => {
    setSubmenu({ index, focus });
  };

  const activate = (entry: MenuEntry, index: number) => {
    if (isSeparator(entry) || entry.disabled === true) return;
    if (isSubmenu(entry)) openSubmenu(index, 'first');
    else onSelect(entry);
  };

  const typeahead = (key: string) => {
    const all = buttons();
    const start = currentIndex();
    for (let offset = 1; offset <= all.length; offset += 1) {
      const index = (start + offset) % all.length;
      const text = all[index]?.textContent.trim().toLocaleLowerCase('de') ?? '';
      if (text.startsWith(key.toLocaleLowerCase('de'))) {
        focusAt(index);
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const { target } = event;
    if (!(target instanceof Element) || target.closest('[role="menu"]') !== event.currentTarget) {
      return;
    }
    const index = currentIndex();
    const entry = items[entryIndex(index)];
    switch (event.key) {
      case 'ArrowDown':
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        focusAt(index - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(-1);
        break;
      case 'Enter':
      case ' ':
        if (entry !== undefined) activate(entry, entryIndex(index));
        break;
      case 'ArrowRight':
        if (entry !== undefined && isSubmenu(entry) && entry.disabled !== true) {
          openSubmenu(entryIndex(index), 'first');
        }
        break;
      case 'ArrowLeft':
      case 'Escape':
        if (event.key === 'ArrowLeft' && !nested) return;
        onClose();
        break;
      case 'Tab':
        onCloseAll();
        return;
      default:
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          typeahead(event.key);
          break;
        }
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const positions = buttonPositions(items);
  return (
    <ul
      ref={list}
      id={id}
      role="menu"
      aria-label={label}
      className={classNames('menu', flip.x && 'flip-x', flip.y && 'flip-y', className)}
      onKeyDown={onKeyDown}
    >
      {items.map((entry, index) => {
        if (isSeparator(entry)) {
          return <li key={`separator-${index}`} role="separator" className="menu-separator" />;
        }
        const position = positions[index] ?? 0;
        const sub = isSubmenu(entry);
        const expanded = submenu?.index === index;
        return (
          <li key={`${entry.label}-${index}`} role="none" className="menu-entry">
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={entry.disabled === true || undefined}
              aria-haspopup={sub ? 'menu' : undefined}
              aria-expanded={sub ? expanded : undefined}
              className={classNames(
                'menu-item',
                !sub && entry.danger === true && 'is-danger',
                expanded && 'is-expanded',
              )}
              onClick={() => activate(entry, index)}
              onMouseEnter={(event) => {
                event.currentTarget.focus();
                if (sub && entry.disabled !== true) openSubmenu(index, 'first');
                else if (submenu !== null) setSubmenu(null);
              }}
            >
              <span className="menu-item-icon">
                {entry.icon !== undefined && <Icon name={entry.icon} />}
              </span>
              <span className="menu-item-label">{entry.label}</span>
              {sub && <Icon name="chevron-right" className="menu-item-more" />}
            </button>
            {sub && expanded && (
              <MenuList
                label={entry.label}
                items={entry.items}
                initialFocus={submenu.focus}
                onSelect={onSelect}
                onClose={() => {
                  setSubmenu(null);
                  focusAt(position);
                }}
                onCloseAll={onCloseAll}
                nested
                className="submenu"
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function useMenuPopup() {
  const id = useId();
  const [open, setOpen] = useState<InitialFocus | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open === null) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || anchor.current?.contains(event.target) !== true) {
        setOpen(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = (restoreFocus: boolean) => {
    setOpen(null);
    if (restoreFocus) trigger.current?.focus();
  };

  const triggerProps = {
    ref: trigger,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open !== null,
    'aria-controls': open === null ? undefined : id,
    onClick: () => {
      if (open === null) setOpen('first');
      else close(false);
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setOpen(event.key === 'ArrowDown' ? 'first' : 'last');
      }
    },
  };

  const anchorProps = {
    ref: anchor,
    onBlur: (event: FocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget;
      if (next instanceof Node && !event.currentTarget.contains(next)) setOpen(null);
    },
  };

  const list = (label: string, items: readonly MenuEntry[], className?: string) =>
    open === null ? null : (
      <MenuList
        id={id}
        label={label}
        items={items}
        initialFocus={open}
        onSelect={(action) => {
          close(true);
          action.onSelect();
        }}
        onClose={() => close(true)}
        onCloseAll={() => close(false)}
        {...(className !== undefined && { className })}
      />
    );

  return { open: open !== null, triggerProps, anchorProps, list };
}

export interface MenuProps {
  readonly label: string;
  readonly items: readonly MenuEntry[];
  readonly align?: 'start' | 'end';
  readonly disabled?: boolean;
  readonly variant?: ButtonVariant;
  readonly icon?: IconName;
  readonly tooltip?: 'bottom' | 'none';
  readonly children?: ReactNode;
  readonly className?: string;
}

export function Menu({
  label,
  items,
  align = 'end',
  disabled = false,
  variant = 'secondary',
  icon = 'more',
  tooltip = 'bottom',
  children,
  className,
}: MenuProps) {
  const popup = useMenuPopup();
  return (
    <div className={classNames('menu-anchor', className)} {...popup.anchorProps}>
      {children === undefined ? (
        <IconButton
          label={label}
          icon={icon}
          disabled={disabled}
          tooltip={popup.open ? 'none' : tooltip}
          {...popup.triggerProps}
        />
      ) : (
        <Button
          variant={variant}
          trailingIcon="chevron-down"
          disabled={disabled}
          {...popup.triggerProps}
        >
          {children}
        </Button>
      )}
      {popup.list(label, items, `align-${align}`)}
    </div>
  );
}

export interface SplitButtonProps {
  readonly label: ReactNode;
  readonly onClick: () => void;
  readonly items: readonly MenuEntry[];
  readonly menuLabel: string;
  readonly variant?: 'primary' | 'secondary';
  readonly disabled?: boolean;
  readonly className?: string;
}

export function SplitButton({
  label,
  onClick,
  items,
  menuLabel,
  variant = 'primary',
  disabled = false,
  className,
}: SplitButtonProps) {
  const popup = useMenuPopup();
  return (
    <div className={classNames('menu-anchor split-btn', className)} {...popup.anchorProps}>
      <Button variant={variant} className="split-btn-main" disabled={disabled} onClick={onClick}>
        {label}
      </Button>
      <button
        type="button"
        aria-label={menuLabel}
        className={classNames('btn', `btn-${variant}`, 'split-btn-toggle')}
        disabled={disabled}
        {...popup.triggerProps}
      >
        <Icon name="chevron-down" />
      </button>
      {popup.list(menuLabel, items, 'align-end')}
    </div>
  );
}
