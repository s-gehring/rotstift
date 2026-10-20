import { useEffect, useId, useRef, type ReactNode } from 'react';
import { classNames } from './class-names.ts';
import { IconButton } from './IconButton.tsx';

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  size = 'md',
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      const previous = returnFocus.current;
      returnFocus.current = null;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={classNames('dialog', `dialog-${size}`, className)}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="dialog-frame">
          <header className="dialog-header">
            <h2 id={titleId}>{title}</h2>
            <IconButton label="Schließen" icon="close" tooltip="none" onClick={onClose} />
          </header>
          <div className="dialog-body">{children}</div>
          {actions !== undefined && <footer className="dialog-actions">{actions}</footer>}
        </div>
      )}
    </dialog>
  );
}
