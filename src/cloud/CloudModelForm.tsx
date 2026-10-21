import { useEffect, useRef, useState } from 'react';
import type { ModelRole } from '../app/types.ts';
import { Button } from '../ui/Button.tsx';
import type { CloudInput } from './client.ts';
import { describeCloudError, type CloudErrorClass } from './errors.ts';
import { CLOUD_TEMPLATES, findTemplate } from './templates.ts';
import type { CloudModel } from './use-cloud.ts';

type Field = 'address' | 'key' | 'model' | 'form';

const FIELD: Readonly<Partial<Record<CloudErrorClass, Field>>> = {
  invalidAddress: 'address',
  insecure: 'address',
  network: 'address',
  keyMissing: 'key',
  auth: 'key',
  notFound: 'model',
  badRequest: 'model',
  invalidResponse: 'model',
};

function FieldError({
  error,
  field,
}: {
  readonly error: CloudErrorClass | null;
  readonly field: Field;
}) {
  if (error === null || (FIELD[error] ?? 'form') !== field) return null;
  return (
    <p className="settings-error" role="alert">
      {describeCloudError(error)}.
    </p>
  );
}

export function CloudWarning({
  onCancel,
  onConfirm,
}: {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  return (
    <div className="confirm cloud-warning" role="alertdialog" aria-labelledby="cloud-warning-title">
      <p id="cloud-warning-title" className="cloud-warning-title">
        Cloud-Modell verwenden?
      </p>
      <p>
        Dieses Modell läuft nicht auf diesem Rechner. Rotstift sendet dafür Daten aus den
        Schülerarbeiten an den verbundenen Drittanbieter. Für die Einhaltung der DSGVO und aller
        anderen Gesetze sind Sie selbst verantwortlich.
      </p>
      <Button ref={cancel} onClick={onCancel}>
        Abbrechen
      </Button>
      <Button variant="quiet" onClick={onConfirm}>
        Verwenden
      </Button>
    </div>
  );
}

export function CloudModelForm({
  role,
  cloud,
  onDone,
}: {
  readonly role: ModelRole;
  readonly cloud: CloudModel;
  readonly onDone: () => void;
}) {
  const [templateId, setTemplateId] = useState('');
  const [address, setAddress] = useState('');
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [error, setError] = useState<CloudErrorClass | null>(null);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState(false);
  const template = findTemplate(templateId);
  const fixed = template?.baseUrl ?? null;
  const id = (name: string) => `cloud-${name}-${role}`;

  const input = (): CloudInput => ({
    template: templateId,
    baseUrl: fixed ?? address.trim(),
    model: model.trim(),
    key: key.trim() === '' ? null : key.trim(),
  });

  const complete =
    template !== undefined &&
    model.trim() !== '' &&
    (fixed !== null || address.trim() !== '') &&
    (template.key === 'optional' || key.trim() !== '');

  async function submit(confirmed: boolean) {
    setWarning(false);
    setError(null);
    setBusy(true);
    const outcome = await cloud.use(role, input(), confirmed);
    setBusy(false);
    if (outcome.state === 'ok') onDone();
    else if (outcome.state === 'consent') setWarning(true);
    else setError(outcome.error);
  }

  if (warning) {
    return <CloudWarning onCancel={() => setWarning(false)} onConfirm={() => void submit(true)} />;
  }

  return (
    <form
      className="cloud-model"
      onSubmit={(event) => {
        event.preventDefault();
        if (complete && !busy) void submit(false);
      }}
    >
      <label htmlFor={id('template')}>Anbieter</label>
      <select
        id={id('template')}
        value={templateId}
        onChange={(event) => {
          setTemplateId(event.target.value);
          setError(null);
        }}
      >
        <option value="" disabled>
          Anbieter wählen
        </option>
        {CLOUD_TEMPLATES.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.label}
          </option>
        ))}
      </select>
      {template !== undefined && fixed === null && (
        <>
          <label htmlFor={id('address')}>Adresse</label>
          <input
            id={id('address')}
            type="url"
            value={address}
            placeholder="https://…/v1"
            spellCheck={false}
            onChange={(event) => setAddress(event.target.value)}
          />
          <FieldError error={error} field="address" />
        </>
      )}
      {template !== undefined && (
        <>
          <label htmlFor={id('key')}>Schlüssel</label>
          <input
            id={id('key')}
            type="password"
            value={key}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setKey(event.target.value)}
          />
          <FieldError error={error} field="key" />
          <label htmlFor={id('model')}>Modell</label>
          <input
            id={id('model')}
            type="text"
            value={model}
            spellCheck={false}
            onChange={(event) => setModel(event.target.value)}
          />
          <FieldError error={error} field="model" />
        </>
      )}
      <FieldError error={error} field="form" />
      <div className="settings-actions">
        <Button type="submit" disabled={!complete || busy}>
          {busy ? 'Wird geprüft …' : 'Verwenden'}
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}

export function CloudKeyForm({
  role,
  cloud,
}: {
  readonly role: ModelRole;
  readonly cloud: CloudModel;
}) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<CloudErrorClass | null>(null);
  const keyId = `cloud-session-key-${role}`;
  return (
    <form
      className="cloud-model-key"
      onSubmit={(event) => {
        event.preventDefault();
        if (key.trim() === '') return;
        void cloud.setKey(role, key.trim()).then(setError);
      }}
    >
      <label htmlFor={keyId}>Schlüssel</label>
      <input
        id={keyId}
        type="password"
        value={key}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setKey(event.target.value)}
      />
      <Button type="submit" disabled={key.trim() === ''}>
        Speichern
      </Button>
      {error !== null && (
        <p className="settings-error" role="alert">
          {describeCloudError(error)}.
        </p>
      )}
    </form>
  );
}
