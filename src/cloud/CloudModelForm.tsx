import { useEffect, useRef, useState } from 'react';
import type { ModelRole } from '../app/types.ts';
import { Button } from '../ui/Button.tsx';
import type { CliInfo, CloudInput, RemoteModel } from './client.ts';
import { describeCloudError, type CloudErrorClass } from './errors.ts';
import { protectionDefault } from './protection.ts';
import { ProtectionSwitch } from './ProtectionSwitch.tsx';
import { findTemplate, VISIBLE_TEMPLATES, type CloudTemplate } from './templates.ts';
import type { CloudModel } from './use-cloud.ts';

type Field = 'address' | 'program' | 'key' | 'model' | 'form';

const FIELD: Readonly<Partial<Record<CloudErrorClass, Field>>> = {
  invalidAddress: 'address',
  insecure: 'address',
  network: 'address',
  keyMissing: 'key',
  auth: 'key',
  notFound: 'model',
  badRequest: 'model',
  invalidResponse: 'model',
  cliMissing: 'program',
  cliOutdated: 'program',
};

type CliSearch =
  | { readonly state: 'searching' }
  | { readonly state: 'found'; readonly cli: CliInfo }
  | { readonly state: 'missing' };

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

function CliProgram({
  template,
  search,
  cloud,
  onPicked,
  error,
}: {
  readonly template: CloudTemplate;
  readonly search: CliSearch;
  readonly cloud: CloudModel;
  readonly onPicked: (cli: CliInfo) => void;
  readonly error: CloudErrorClass | null;
}) {
  const [pickError, setPickError] = useState<CloudErrorClass | null>(null);
  async function pick() {
    setPickError(null);
    const outcome = await cloud.pickCli(template.id);
    if (outcome.state === 'error') setPickError(outcome.error);
    else if (outcome.cli !== null) onPicked(outcome.cli);
  }
  return (
    <div className="cloud-cli" role="group" aria-label="Programm">
      <span className="cloud-cli-title">Programm</span>
      {search.state === 'searching' && <p className="settings-model-note">Wird gesucht …</p>}
      {search.state === 'found' && (
        <p className="settings-model-note">
          <span className="cloud-cli-path">{search.cli.path}</span> · Version {search.cli.version}
        </p>
      )}
      {search.state === 'found' && search.cli.notes?.includes('globalInstructions') === true && (
        <p className="settings-model-note" role="note">
          Im Codex-Ordner liegt eine eigene AGENTS.md. Codex liest sie trotz Abschirmung und gibt
          sie an das Modell weiter. Am besten entfernen oder umbenennen Sie sie vor dem Verwenden.
        </p>
      )}
      {template.cli?.hint !== undefined && (
        <p className="settings-model-note">{template.cli.hint}</p>
      )}
      {search.state === 'missing' && (
        <p className="settings-model-note">
          Nicht gefunden. Installieren im Terminal: <code>{template.cli?.install}</code>
        </p>
      )}
      <Button variant="quiet" onClick={() => void pick()}>
        Datei wählen …
      </Button>
      {pickError !== null && (
        <p className="settings-error" role="alert">
          {describeCloudError(pickError)}.
        </p>
      )}
      <FieldError error={error} field="program" />
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
  const [protectionOverride, setProtectionOverride] = useState<{
    readonly on: boolean;
    readonly confirmed: boolean;
  } | null>(null);
  const [models, setModels] = useState<readonly RemoteModel[] | null>(null);
  const [modelsError, setModelsError] = useState<CloudErrorClass | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [cliSearch, setCliSearch] = useState<CliSearch>({ state: 'searching' });
  const template = findTemplate(templateId);
  const viaCli = template?.api === 'cli';
  const fixed = template?.baseUrl ?? null;
  const listed = template?.api === 'anthropic';
  const cli = cliSearch.state === 'found' ? cliSearch.cli : null;
  const searching = useRef('');

  function searchCli(id: string) {
    searching.current = id;
    setCliSearch({ state: 'searching' });
    void cloud.findCli(id).then((outcome) => {
      if (searching.current !== id) return;
      setCliSearch(
        outcome.state === 'ok' && outcome.cli !== null
          ? { state: 'found', cli: outcome.cli }
          : { state: 'missing' },
      );
    });
  }
  const id = (name: string) => `cloud-${name}-${role}`;

  const baseUrl = fixed ?? address.trim();
  const defaultProtection = protectionDefault(templateId, baseUrl);
  const protection = protectionOverride?.on ?? defaultProtection;
  const blockedByProtection = role === 'transcriber' && protection;

  const input = (): CloudInput => ({
    template: templateId,
    baseUrl,
    model: model.trim(),
    key: viaCli || key.trim() === '' ? null : key.trim(),
    cliPath: viaCli ? (cli?.path ?? null) : null,
    protection: protectionOverride?.on ?? null,
    protectionConfirmed: protectionOverride?.confirmed ?? false,
  });

  const complete =
    template !== undefined &&
    !blockedByProtection &&
    model.trim() !== '' &&
    (fixed !== null || address.trim() !== '') &&
    (viaCli ? cli !== null : template.key === 'optional' || key.trim() !== '');

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

  async function loadModels() {
    setModelsError(null);
    setLoadingModels(true);
    const outcome = await cloud.models(input());
    setLoadingModels(false);
    if (outcome.state === 'ok') {
      setModels(outcome.models);
      setModel((current) => (outcome.models.some((entry) => entry.id === current) ? current : ''));
    } else {
      setModelsError(outcome.error);
    }
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
          if (findTemplate(event.target.value)?.api === 'cli') searchCli(event.target.value);
          else searching.current = '';
          setProtectionOverride(null);
          setModel('');
          setModels(null);
          setModelsError(null);
          setError(null);
        }}
      >
        <option value="" disabled>
          Anbieter wählen
        </option>
        {VISIBLE_TEMPLATES.map((candidate) => (
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
            onChange={(event) => {
              setAddress(event.target.value);
              setProtectionOverride(null);
            }}
          />
          <FieldError error={error} field="address" />
        </>
      )}
      {template !== undefined && viaCli && (
        <>
          <CliProgram
            template={template}
            search={cliSearch}
            cloud={cloud}
            error={error}
            onPicked={(picked) => {
              searching.current = '';
              setCliSearch({ state: 'found', cli: picked });
            }}
          />
          <label htmlFor={id('model')}>Modell</label>
          <select id={id('model')} value={model} onChange={(event) => setModel(event.target.value)}>
            <option value="" disabled>
              Modell wählen
            </option>
            {template.cli?.models.map((alias) => (
              <option key={alias} value={alias}>
                {alias}
              </option>
            ))}
          </select>
          <FieldError error={error} field="model" />
        </>
      )}
      {template !== undefined && !viaCli && (
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
          {listed ? (
            <>
              <Button
                variant="quiet"
                disabled={key.trim() === '' || loadingModels}
                onClick={() => void loadModels()}
              >
                {loadingModels ? 'Wird geladen …' : 'Modelle laden'}
              </Button>
              {models !== null && (
                <select
                  id={id('model')}
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                >
                  <option value="" disabled>
                    Modell wählen
                  </option>
                  {models.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.displayName === entry.id
                        ? entry.id
                        : `${entry.displayName} (${entry.id})`}
                    </option>
                  ))}
                </select>
              )}
              {modelsError !== null && (
                <p className="settings-error" role="alert">
                  {describeCloudError(modelsError)}.
                </p>
              )}
            </>
          ) : (
            <input
              id={id('model')}
              type="text"
              value={model}
              spellCheck={false}
              onChange={(event) => setModel(event.target.value)}
            />
          )}
          <FieldError error={error} field="model" />
        </>
      )}
      {template !== undefined && (
        <ProtectionSwitch
          role={role}
          on={protection}
          askBeforeOff={defaultProtection}
          subscription={viaCli}
          onChange={(on, confirmed) => setProtectionOverride({ on, confirmed })}
        />
      )}
      <FieldError error={error} field="form" />
      {viaCli && error === 'notLoggedIn' && (
        <p className="settings-model-note">
          Im Terminal anmelden: <code>{template.cli?.login}</code>, danach erneut „Verwenden“.
        </p>
      )}
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
