import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/app-context.tsx';
import type { Models, ModelRole } from '../app/types.ts';
import { formatRemaining } from '../pipeline/progress.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Icon } from '../ui/icons.tsx';
import { ProgressBar } from '../ui/ProgressBar.tsx';
import { describeDownloadError, formatMemory, formatSize, remainingMs } from './format.ts';
import {
  estimateRamBytes,
  exceedsMemory,
  modelFiles,
  totalBytes,
  type AnyModelInfo,
} from './registry.ts';
import { ROLE_NAME } from './role-text.ts';
import type { ModelState } from './types.ts';
import type { ModelSetup } from './use-model-setup.ts';

interface RoleSetup {
  readonly role: ModelRole;
  readonly name: string;
  readonly setup: ModelSetup<AnyModelInfo>;
}

function setupOf(models: Models, role: ModelRole): ModelSetup<AnyModelInfo> {
  switch (role) {
    case 'transcriber':
      return models.transcriber;
    case 'corrector':
      return models.corrector;
    case 'reviewer':
      return models.reviewer;
    default: {
      const unreachable: never = role;
      return unreachable;
    }
  }
}

function distinctModels(models: Models, roles: readonly ModelRole[]): RoleSetup[] {
  const entries: RoleSetup[] = [];
  for (const role of roles) {
    const setup = setupOf(models, role);
    const index = entries.findIndex((entry) => entry.setup.model.id === setup.model.id);
    const shared = entries[index];
    if (shared === undefined) {
      entries.push({ role, name: ROLE_NAME[role], setup });
    } else {
      entries[index] = { ...shared, name: `${shared.name} sowie ${ROLE_NAME[role]}` };
    }
  }
  return entries;
}

const BUSY: ReadonlySet<ModelState> = new Set([
  'downloading',
  'verifying',
  'importing',
  'deleting',
]);

const STATE_TEXT: Partial<Readonly<Record<ModelState, string>>> = {
  ready: 'Bereit',
  downloading: 'Wird geladen',
  verifying: 'Wird geprüft',
  importing: 'Wird importiert',
  deleting: 'Wird gelöscht',
  corrupt: 'Beschädigt',
};

function stateOf(entry: RoleSetup): ModelState | null {
  return entry.setup.status?.state ?? null;
}

function toLoadBytes(entry: RoleSetup): number {
  const { status, model } = entry.setup;
  const total = totalBytes(model);
  if (status === null) return total;
  if (status.state === 'ready') return 0;
  const present = status.state === 'downloading' ? entry.setup.baseline : status.downloadedBytes;
  return Math.max(0, total - present);
}

function doneBytes(entry: RoleSetup): number {
  const { status } = entry.setup;
  if (status?.state !== 'downloading') return 0;
  return Math.max(0, status.downloadedBytes - entry.setup.baseline);
}

function remainingText(entries: readonly RoleSetup[]): string | null {
  const times = entries.flatMap(({ setup }) => {
    const { status } = setup;
    if (status?.state !== 'downloading') return [];
    const ms = remainingMs(setup.samples, status.downloadedBytes, status.totalBytes);
    return ms === null ? [] : [ms];
  });
  return times.length === 0 ? null : `noch ${formatRemaining(Math.max(...times))}`;
}

function CopyAddress({ url, name }: { readonly url: string; readonly name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="quiet"
      aria-label={`Adresse von ${name} kopieren`}
      onClick={() => {
        navigator.clipboard.writeText(url).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      {copied ? 'Kopiert' : 'Adresse kopieren'}
    </Button>
  );
}

function OfflineImport({ entries }: { readonly entries: readonly RoleSetup[] }) {
  return (
    <details className="setup-offline">
      <summary>Aus Datei importieren …</summary>
      <p>Ohne Internet: Diese Dateien auf einem anderen Rechner laden und hier auswählen.</p>
      {entries.map(({ role, name, setup }) => (
        <section key={role} className="setup-offline-role" aria-label={name}>
          <h3>{name}</h3>
          <ul>
            {modelFiles(setup.model).map((file) => (
              <li key={file.name}>
                <span className="setup-file-name">{file.name}</span>
                <span className="setup-file-size">{formatSize(file.bytes)}</span>
                <code className="download-url">{file.url}</code>
                <CopyAddress url={file.url} name={file.name} />
              </li>
            ))}
          </ul>
          <Button
            disabled={setup.state.importing || BUSY.has(setup.status?.state ?? 'missing')}
            onClick={() => void setup.importFiles()}
          >
            {setup.state.importing ? 'Wird importiert …' : 'Dateien auswählen …'}
          </Button>
          {setup.state.note !== null && <p className="setup-note">{setup.state.note}</p>}
        </section>
      ))}
    </details>
  );
}

function RoleErrors({ entry }: { readonly entry: RoleSetup }) {
  const { setup, name } = entry;
  const state = stateOf(entry);
  if (setup.loadError !== null) {
    return (
      <p className="setup-error" role="alert">
        <span>
          {name}: {describeDownloadError(setup.loadError)}
        </span>
        <Button variant="quiet" onClick={() => void setup.refresh()}>
          Erneut versuchen
        </Button>
      </p>
    );
  }
  if (state === 'unverified') {
    return (
      <p className="setup-error" role="alert">
        <span>{name}: Die vorhandenen Dateien ließen sich nicht prüfen.</span>
        <Button variant="quiet" onClick={() => void setup.verifyAgain()}>
          Erneut versuchen
        </Button>
      </p>
    );
  }
  if (setup.error === null) return null;
  return (
    <p className="setup-error" role="alert">
      <span>
        {name}: {describeDownloadError(setup.error)}
      </span>
      <Button
        variant="quiet"
        onClick={() => {
          setup.clearError();
          void setup.download();
        }}
      >
        Erneut versuchen
      </Button>
    </p>
  );
}

export function SetupDialog() {
  const { models } = useApp();
  const request = models.setup;
  const entries = distinctModels(models, request.roles);
  const available = entries.every((entry) => entry.setup.available);
  const total = entries.reduce((sum, entry) => sum + toLoadBytes(entry), 0);
  const done = entries.reduce((sum, entry) => sum + doneBytes(entry), 0);
  const states = entries.map(stateOf);
  const downloading = states.includes('downloading');
  const busy = states.some((state) => state !== null && BUSY.has(state));
  const startable = entries.filter((entry) => {
    const state = stateOf(entry);
    return (
      state !== null &&
      state !== 'ready' &&
      state !== 'unverified' &&
      !BUSY.has(state) &&
      !entry.setup.state.importing
    );
  });
  const neededBytes = startable.reduce((sum, entry) => sum + toLoadBytes(entry), 0);
  const hardware =
    models.transcriber.state.hardware ??
    models.corrector.state.hardware ??
    models.reviewer.state.hardware;
  const totalRam = hardware?.totalRamBytes ?? null;
  const lowMemory = entries
    .map((entry) => entry.setup.model)
    .filter((model) => exceedsMemory(model, totalRam))
    .reduce<AnyModelInfo | undefined>(
      (largest, model) =>
        largest === undefined ||
        estimateRamBytes(model, totalRam) > estimateRamBytes(largest, totalRam)
          ? model
          : largest,
      undefined,
    );
  const freeDisk = hardware?.freeDiskBytes ?? null;
  const lowDisk = freeDisk !== null && startable.length > 0 && freeDisk < neededBytes;
  const open = request.open && available;
  const canStart = !downloading && startable.length > 0;
  const startButton = useRef<HTMLButtonElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!open) focused.current = false;
    else if (canStart && !focused.current) {
      focused.current = true;
      startButton.current?.focus();
    }
  }, [open, canStart]);
  const progressText = downloading
    ? [`${formatSize(done)} von ${formatSize(total)}`, remainingText(entries)]
        .filter(Boolean)
        .join(' · ')
    : states.includes('verifying')
      ? 'Wird geprüft …'
      : 'Wird importiert …';

  return (
    <Dialog
      open={open}
      onClose={request.close}
      title="Einmalige Einrichtung"
      size="md"
      className="setup-dialog"
      actions={
        downloading ? (
          <Button
            onClick={() => {
              for (const entry of entries) {
                if (stateOf(entry) === 'downloading') void entry.setup.cancel();
              }
            }}
          >
            Abbrechen
          </Button>
        ) : (
          <>
            <Button onClick={request.close}>Abbrechen</Button>
            <Button
              variant="primary"
              ref={startButton}
              disabled={startable.length === 0}
              onClick={() => {
                for (const entry of startable) void entry.setup.download();
              }}
            >
              Herunterladen
            </Button>
          </>
        )
      }
    >
      <ul className="setup-models">
        {entries.map((entry) => {
          const state = stateOf(entry);
          const label = state === null ? undefined : STATE_TEXT[state];
          return (
            <li key={entry.role} data-state={state ?? 'unknown'}>
              <span className="setup-model-name">{entry.name}</span>
              <span className="setup-model-size">
                {state === 'ready' ? '' : formatSize(toLoadBytes(entry))}
              </span>
              <span className="setup-model-state">
                {state === 'ready' && <Icon name="check" />}
                {label}
              </span>
            </li>
          );
        })}
        {entries.length > 1 && (
          <li className="setup-models-total">
            <span className="setup-model-name">Zusammen</span>
            <span className="setup-model-size">{formatSize(total)}</span>
            <span className="setup-model-state" />
          </li>
        )}
      </ul>

      {busy && (
        <div className="setup-progress">
          <ProgressBar
            label="Fortschritt der Einrichtung"
            value={downloading ? done : null}
            max={total}
            valueText={progressText}
          />
          <p className="setup-progress-text">{progressText}</p>
        </div>
      )}

      {lowMemory !== undefined && totalRam !== null && (
        <p className="setup-warning">
          {lowMemory.displayName} braucht etwa {formatSize(estimateRamBytes(lowMemory, totalRam))},
          dieser Rechner hat {formatMemory(totalRam)} Arbeitsspeicher.
        </p>
      )}
      {lowDisk && (
        <p className="setup-warning">
          Frei sind nur {formatSize(freeDisk)}, gebraucht werden {formatSize(neededBytes)}.
        </p>
      )}

      {entries.map((entry) => (
        <RoleErrors key={entry.role} entry={entry} />
      ))}

      {!downloading && <OfflineImport entries={entries} />}
    </Dialog>
  );
}
