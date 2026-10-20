import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './Button.tsx';
import { classNames } from './class-names.ts';
import { IconButton } from './IconButton.tsx';

export interface ToastAction {
  readonly label: string;
  readonly onAction: () => void;
}

export interface ToastOptions {
  readonly action?: ToastAction;
  readonly tone?: 'info' | 'error';
  readonly durationMs?: number;
}

export interface ToastMessage {
  readonly id: number;
  readonly text: string;
  readonly action: ToastAction | null;
  readonly tone: 'info' | 'error';
  readonly durationMs: number;
}

export interface Toasts {
  readonly current: ToastMessage | null;
  readonly show: (text: string, options?: ToastOptions) => void;
  readonly dismiss: () => void;
}

export const TOAST_DURATION_MS = 4000;
export const TOAST_ACTION_DURATION_MS = 8000;

export function useToast(): Toasts {
  const [current, setCurrent] = useState<ToastMessage | null>(null);
  const counter = useRef(0);
  const show = useCallback((text: string, options: ToastOptions = {}) => {
    counter.current += 1;
    setCurrent({
      id: counter.current,
      text,
      action: options.action ?? null,
      tone: options.tone ?? 'info',
      durationMs:
        options.durationMs ??
        (options.action === undefined ? TOAST_DURATION_MS : TOAST_ACTION_DURATION_MS),
    });
  }, []);
  const dismiss = useCallback(() => setCurrent(null), []);
  return useMemo(() => ({ current, show, dismiss }), [current, show, dismiss]);
}

function ToastCard({
  toast,
  onDismiss,
}: {
  readonly toast: ToastMessage;
  readonly onDismiss: () => void;
}) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return undefined;
    const timer = window.setTimeout(onDismiss, toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [paused, toast, onDismiss]);
  const { action } = toast;
  return (
    <div
      className={classNames('toast', toast.tone === 'error' && 'is-error')}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast-text">{toast.text}</span>
      {action !== null && (
        <Button
          variant="quiet"
          className="toast-action"
          onClick={() => {
            onDismiss();
            action.onAction();
          }}
        >
          {action.label}
        </Button>
      )}
      <IconButton label="Meldung schließen" icon="close" tooltip="none" onClick={onDismiss} />
    </div>
  );
}

export function ToastRegion({ toasts }: { readonly toasts: Toasts }) {
  const { current, dismiss } = toasts;
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {current !== null && <ToastCard key={current.id} toast={current} onDismiss={dismiss} />}
    </div>
  );
}
