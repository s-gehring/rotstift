import { useEffect, useRef, useState } from 'react';
import type { ModelRole } from '../app/types.ts';
import { Button } from '../ui/Button.tsx';
import {
  PROTECTED_RECOGNITION_NOTE,
  PROTECTION_LABEL,
  PROTECTION_OFF_IMAGES,
  PROTECTION_OFF_LIABILITY,
  PROTECTION_OFF_SUBSCRIPTION,
  PROTECTION_OFF_TEXT,
  PROTECTION_OFF_TITLE,
  PROTECTION_ON_NOTE,
} from './protection.ts';

export function ProtectionWarning({
  role,
  subscription,
  onCancel,
  onConfirm,
}: {
  readonly role: ModelRole;
  readonly subscription: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  return (
    <div
      className="confirm cloud-warning"
      role="alertdialog"
      aria-labelledby={`protection-warning-title-${role}`}
    >
      <p id={`protection-warning-title-${role}`} className="cloud-warning-title">
        {PROTECTION_OFF_TITLE}
      </p>
      <p>
        {PROTECTION_OFF_TEXT}
        {role === 'transcriber' && ` ${PROTECTION_OFF_IMAGES}`}
        {subscription && ` ${PROTECTION_OFF_SUBSCRIPTION}`} {PROTECTION_OFF_LIABILITY}
      </p>
      <Button ref={cancel} onClick={onCancel}>
        Abbrechen
      </Button>
      <Button variant="quiet" onClick={onConfirm}>
        Schutz ausschalten
      </Button>
    </div>
  );
}

export function ProtectionSwitch({
  role,
  on,
  askBeforeOff,
  subscription = false,
  disabled = false,
  onChange,
}: {
  readonly role: ModelRole;
  readonly on: boolean;
  readonly askBeforeOff: boolean;
  readonly subscription?: boolean;
  readonly disabled?: boolean;
  readonly onChange: (on: boolean, confirmed: boolean) => void;
}) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <ProtectionWarning
        role={role}
        subscription={subscription}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          onChange(false, true);
        }}
      />
    );
  }
  const id = `cloud-protection-${role}`;
  return (
    <div className="cloud-protection">
      <label htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={on}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.checked) onChange(true, false);
            else if (askBeforeOff) setAsking(true);
            else onChange(false, false);
          }}
        />{' '}
        {PROTECTION_LABEL}
      </label>
      {on && (
        <p className="settings-model-note">
          {role === 'transcriber' ? PROTECTED_RECOGNITION_NOTE : PROTECTION_ON_NOTE}
        </p>
      )}
    </div>
  );
}
