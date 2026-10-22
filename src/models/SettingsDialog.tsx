import { useEffect, useRef, useState } from 'react';
import packageInfo from '../../package.json';
import { useApp } from '../app/app-context.tsx';
import type { ModelRole } from '../app/types.ts';
import { CloudKeyForm, CloudModelForm } from '../cloud/CloudModelForm.tsx';
import { privacyNote } from '../cloud/remote.ts';
import { findTemplate } from '../cloud/templates.ts';
import type { CloudModel } from '../cloud/use-cloud.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { DiagnosticsLog } from './DiagnosticsLog.tsx';
import { describeDownloadError, formatSize } from './format.ts';
import {
  customSource,
  estimateRamBytes,
  exceedsMemory,
  totalBytes,
  type AnyModelInfo,
  type FileRole,
} from './registry.ts';
import { ROLE_NAME } from './role-text.ts';
import type { ModelState, ResolvedLink } from './types.ts';
import { hasRunningJob } from './setup-state.ts';
import {
  LEVELS,
  levelExceedsMemory,
  THOROUGHNESS,
  THOROUGHNESS_NAME,
  thoroughnessOf,
  type Thoroughness,
} from './thoroughness.ts';
import type { ModelSetup } from './use-model-setup.ts';
import { WeightingSettings } from './WeightingSettings.tsx';

const STATE_TEXT: Readonly<Record<ModelState, string>> = {
  ready: 'Bereit',
  missing: 'Nicht eingerichtet',
  downloading: 'Wird geladen',
  verifying: 'Wird geprüft',
  importing: 'Wird importiert',
  deleting: 'Wird gelöscht',
  unverified: 'Nicht geprüft',
  corrupt: 'Beschädigt',
};

const BUSY: ReadonlySet<ModelState> = new Set([
  'downloading',
  'verifying',
  'importing',
  'deleting',
]);

const FILE_ROLE: Readonly<Record<ModelRole, FileRole>> = {
  transcriber: 'transcriber',
  corrector: 'corrector',
  reviewer: 'corrector',
};

function CustomModelForm({
  role,
  setup,
  onDone,
}: {
  readonly role: ModelRole;
  readonly setup: ModelSetup<AnyModelInfo>;
  readonly onDone: () => void;
}) {
  const [link, setLink] = useState('');
  const [checking, setChecking] = useState(false);
  const [resolved, setResolved] = useState<ResolvedLink | null>(null);
  const [modelPath, setModelPath] = useState<string | null>(null);
  const [projectorPath, setProjectorPath] = useState<string | null>(null);
  const vision = FILE_ROLE[role] === 'transcriber';
  const linkId = `custom-link-${role}`;

  async function check() {
    setChecking(true);
    setResolved(null);
    const result = await setup.resolveLink(link.trim());
    setChecking(false);
    if (result === null) return;
    setResolved(result);
    setModelPath(result.model);
    setProjectorPath(vision ? result.projector : null);
  }

  const ready = resolved !== null && modelPath !== null && (!vision || projectorPath !== null);
  return (
    <div className="custom-model">
      <form
        className="custom-model-link"
        onSubmit={(event) => {
          event.preventDefault();
          if (link.trim() !== '') void check();
        }}
      >
        <label htmlFor={linkId}>Link zu Hugging Face</label>
        <input
          id={linkId}
          type="text"
          value={link}
          placeholder="https://huggingface.co/…"
          spellCheck={false}
          onChange={(event) => {
            setLink(event.target.value);
            setResolved(null);
          }}
        />
        <Button type="submit" disabled={checking || link.trim() === ''}>
          {checking ? 'Wird geprüft …' : 'Prüfen'}
        </Button>
      </form>
      {resolved !== null && (
        <div className="custom-model-files">
          {resolved.models.length > 1 && (
            <label>
              Modelldatei
              <select
                value={modelPath ?? ''}
                onChange={(event) => setModelPath(event.target.value)}
              >
                {resolved.models.map((file) => (
                  <option key={file.path} value={file.path}>
                    {file.path} ({formatSize(file.bytes)})
                  </option>
                ))}
              </select>
            </label>
          )}
          {vision && resolved.projectors.length > 1 && (
            <label>
              Bilddatei
              <select
                value={projectorPath ?? ''}
                onChange={(event) => setProjectorPath(event.target.value)}
              >
                {resolved.projectors.map((file) => (
                  <option key={file.path} value={file.path}>
                    {file.path} ({formatSize(file.bytes)})
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="settings-note">
            {resolved.repo} ·{' '}
            {formatSize(
              [modelPath, projectorPath].reduce(
                (sum, path) =>
                  sum +
                  ([...resolved.models, ...resolved.projectors].find((file) => file.path === path)
                    ?.bytes ?? 0),
                0,
              ),
            )}
          </p>
          <Button
            disabled={!ready}
            onClick={() => {
              if (modelPath === null) return;
              onDone();
              void setup.addLink(resolved, modelPath, vision ? projectorPath : null);
            }}
          >
            Hinzufügen und laden
          </Button>
        </div>
      )}
      <div className="settings-actions">
        <Button
          variant="quiet"
          disabled={setup.state.importing}
          onClick={() => {
            onDone();
            void setup.importCustom();
          }}
        >
          Datei wählen …
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}

function DeleteConfirm({
  name,
  onDelete,
  onKeep,
}: {
  readonly name: string;
  readonly onDelete: () => void;
  readonly onKeep: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus();
  }, []);
  return (
    <div className="confirm" role="alertdialog" aria-label={`${name} löschen`}>
      <p>{name} wirklich löschen?</p>
      <Button variant="quiet" className="is-danger" onClick={onDelete}>
        Löschen
      </Button>
      <Button ref={keep} onClick={onKeep}>
        Behalten
      </Button>
    </div>
  );
}

function CloudRow({
  role,
  cloud,
  locked,
}: {
  readonly role: ModelRole;
  readonly cloud: CloudModel;
  readonly locked: boolean;
}) {
  const step = cloud.steps[role];
  if (step === undefined) return null;
  const needsKey = step.key === null && findTemplate(step.template)?.key === 'required';
  return (
    <>
      <div className="settings-model">
        <label className="settings-model-label">
          <input type="radio" name={`model-choice-${role}`} checked readOnly />
          <span className="settings-model-text">
            <span className="settings-model-line">
              <span className="settings-model-name">{step.model}</span>
              <span className="settings-model-state" data-state="cloud">
                {step.template === 'server' ? 'Eigener Server' : 'Cloud'}
              </span>
            </span>
            <span className="settings-model-note">
              {step.label === step.host ? step.host : `${step.label} · ${step.host}`}
            </span>
            {step.key === 'session' && (
              <span className="settings-model-note">Schlüssel gilt nur bis zum Beenden.</span>
            )}
          </span>
        </label>
        <Button variant="quiet" disabled={locked} onClick={() => void cloud.clear(role)}>
          Ausschalten
        </Button>
      </div>
      {needsKey && <CloudKeyForm role={role} cloud={cloud} />}
    </>
  );
}

function ModelSection({
  role,
  setup,
  cloud,
  locked,
  sharedWith = null,
  onSetup,
}: {
  readonly role: ModelRole;
  readonly setup: ModelSetup<AnyModelInfo>;
  readonly cloud: CloudModel;
  readonly locked: boolean;
  readonly sharedWith?: ModelRole | null;
  readonly onSetup: () => void;
}) {
  const [confirming, setConfirming] = useState<AnyModelInfo | null>(null);
  const [adding, setAdding] = useState(false);
  const [addingCloud, setAddingCloud] = useState(false);
  const remote = cloud.steps[role] !== undefined;
  const { model, status } = setup;
  const state = status?.state ?? null;
  const busy = state !== null && BUSY.has(state);
  const ram = setup.state.hardware?.totalRamBytes ?? null;
  const rows = setup.models;
  const choice = rows.length > 1 || remote;
  const headingId = `settings-${role}`;
  const source = customSource(model);
  const switchDisabled = locked || hasRunningJob(setup.state);
  const confirmName = choice && confirming !== null ? confirming.displayName : ROLE_NAME[role];
  return (
    <section className="settings-section" aria-labelledby={headingId}>
      <h3 id={headingId}>{ROLE_NAME[role]}</h3>
      <fieldset className="model-choice" disabled={switchDisabled}>
        <legend className="visually-hidden">{ROLE_NAME[role]}</legend>
        <CloudRow role={role} cloud={cloud} locked={locked} />
        {rows.map((candidate) => {
          const candidateState = setup.state.statuses[candidate.id]?.state ?? null;
          const candidateBusy = candidateState !== null && BUSY.has(candidateState);
          const hasFiles =
            candidateState === 'ready' ||
            candidateState === 'corrupt' ||
            (setup.state.statuses[candidate.id]?.downloadedBytes ?? 0) > 0;
          const origin = customSource(candidate);
          const tooLarge = exceedsMemory(candidate, ram);
          return (
            <div key={candidate.id} className="settings-model">
              <label className="settings-model-label">
                {choice && (
                  <input
                    type="radio"
                    name={`model-choice-${role}`}
                    checked={!remote && candidate.id === model.id}
                    onChange={() => {
                      void (async () => {
                        if (remote) await cloud.clear(role);
                        await setup.select(candidate.id);
                      })();
                    }}
                  />
                )}
                <span className="settings-model-text">
                  <span className="settings-model-line">
                    <span className="settings-model-name">{candidate.displayName}</span>
                    <span className="settings-model-size">{formatSize(totalBytes(candidate))}</span>
                    <span className="settings-model-need" data-warn={tooLarge ? 'true' : undefined}>
                      braucht etwa {formatSize(estimateRamBytes(candidate, ram))}
                      {tooLarge && (
                        <span className="visually-hidden">
                          , mehr als der verfügbare Arbeitsspeicher
                        </span>
                      )}
                    </span>
                    <span className="settings-model-state" data-state={candidateState ?? 'unknown'}>
                      {candidateState === null ? '' : STATE_TEXT[candidateState]}
                    </span>
                  </span>
                  {origin !== null && (
                    <span className="settings-model-note">
                      {origin.kind === 'huggingFace' ? origin.repo : 'Eigene Datei'}
                    </span>
                  )}
                </span>
              </label>
              {hasFiles && !candidateBusy && (
                <Button
                  variant="quiet"
                  className="is-danger"
                  disabled={locked}
                  onClick={() => setConfirming(candidate)}
                >
                  Löschen
                </Button>
              )}
            </div>
          );
        })}
      </fieldset>
      {setup.error !== null && (
        <p className="settings-error" role="alert">
          {describeDownloadError(setup.error)}
          {model.id !== setup.defaultId && (
            <Button
              variant="quiet"
              disabled={switchDisabled}
              onClick={() => void setup.selectRecommended()}
            >
              Empfohlenes Modell nutzen
            </Button>
          )}
        </p>
      )}
      {setup.state.note !== null && <p className="settings-note">{setup.state.note}</p>}
      {sharedWith !== null && (
        <p className="settings-note">
          Wird auch für {ROLE_NAME[sharedWith]} verwendet und nur einmal gespeichert.
        </p>
      )}
      {confirming !== null ? (
        <DeleteConfirm
          name={confirmName}
          onDelete={() => {
            setConfirming(null);
            void setup.remove(confirming.id);
          }}
          onKeep={() => setConfirming(null)}
        />
      ) : adding ? (
        <CustomModelForm role={role} setup={setup} onDone={() => setAdding(false)} />
      ) : addingCloud ? (
        <CloudModelForm role={role} cloud={cloud} onDone={() => setAddingCloud(false)} />
      ) : (
        <div className="settings-actions">
          {state === 'unverified' && (
            <Button onClick={() => void setup.verifyAgain()}>Erneut prüfen</Button>
          )}
          {state !== null && state !== 'ready' && !busy && source?.kind !== 'file' && (
            <>
              <Button onClick={onSetup}>Herunterladen</Button>
              <Button
                variant="quiet"
                disabled={setup.state.importing}
                onClick={() => void setup.importFiles()}
              >
                {setup.state.importing ? 'Wird importiert …' : 'Modell aus Datei importieren …'}
              </Button>
            </>
          )}
          <Button variant="quiet" disabled={switchDisabled} onClick={() => setAdding(true)}>
            Eigenes Modell …
          </Button>
          {cloud.available && (
            <Button variant="quiet" disabled={switchDisabled} onClick={() => setAddingCloud(true)}>
              Cloud-Modell …
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function SecondReadingSection({ locked }: { readonly locked: boolean }) {
  const { models } = useApp();
  const { secondReader: setup, secondReading } = models;
  const [confirming, setConfirming] = useState(false);
  const { model, status } = setup;
  const state = status?.state ?? null;
  const busy = state !== null && BUSY.has(state);
  const ram = setup.state.hardware?.totalRamBytes ?? null;
  const tooLarge = exceedsMemory(model, ram);
  const hasFiles = state === 'ready' || state === 'corrupt' || (status?.downloadedBytes ?? 0) > 0;
  const name = ROLE_NAME.secondReader;
  return (
    <section className="settings-section" aria-labelledby="settings-secondReader">
      <h3 id="settings-secondReader">{name}</h3>
      <div className="settings-model">
        <label className="settings-model-label">
          <input
            type="checkbox"
            checked={secondReading.enabled}
            disabled={locked}
            onChange={(event) => secondReading.set(event.target.checked)}
          />
          <span className="settings-model-text">
            <span className="settings-model-line">
              <span className="settings-model-name">{model.displayName}</span>
              <span className="settings-model-size">{formatSize(totalBytes(model))}</span>
              <span className="settings-model-need" data-warn={tooLarge ? 'true' : undefined}>
                braucht etwa {formatSize(estimateRamBytes(model, ram))}
              </span>
              <span className="settings-model-state" data-state={state ?? 'unknown'}>
                {state === null ? '' : STATE_TEXT[state]}
              </span>
            </span>
          </span>
        </label>
        {hasFiles && !busy && (
          <Button
            variant="quiet"
            className="is-danger"
            disabled={locked}
            onClick={() => setConfirming(true)}
          >
            Löschen
          </Button>
        )}
      </div>
      {setup.error !== null && (
        <p className="settings-error" role="alert">
          {describeDownloadError(setup.error)}
        </p>
      )}
      {confirming ? (
        <DeleteConfirm
          name={name}
          onDelete={() => {
            setConfirming(false);
            void setup.remove(model.id);
          }}
          onKeep={() => setConfirming(false)}
        />
      ) : (
        secondReading.enabled &&
        state !== null &&
        state !== 'ready' &&
        !busy && (
          <div className="settings-actions">
            <Button onClick={() => models.setup.show(['secondReader'])}>Herunterladen</Button>
          </div>
        )
      )}
    </section>
  );
}

function ThoroughnessSection({ locked }: { readonly locked: boolean }) {
  const { models } = useApp();
  const { transcriber, corrector, reviewer, secondReading, cloud } = models;
  const ram = transcriber.state.hardware?.totalRamBytes ?? null;
  const local = (role: ModelRole, id: string) => (cloud.steps[role] === undefined ? id : null);
  const current = thoroughnessOf({
    transcriber: local('transcriber', transcriber.model.id),
    corrector: local('corrector', corrector.model.id),
    reviewer: local('reviewer', reviewer.model.id),
    secondReading: secondReading.enabled,
  });
  const choose = async (level: Thoroughness) => {
    const wanted = LEVELS[level];
    const steps = [
      ['transcriber', transcriber, wanted.transcriber],
      ['corrector', corrector, wanted.corrector],
      ['reviewer', reviewer, wanted.reviewer],
    ] as const;
    for (const [role, setup, id] of steps) {
      if (cloud.steps[role] !== undefined) await cloud.clear(role);
      await setup.select(id);
    }
    secondReading.set(wanted.secondReading);
  };
  return (
    <section className="settings-section" aria-labelledby="settings-thoroughness">
      <h3 id="settings-thoroughness">Gründlichkeit</h3>
      <fieldset className="model-choice" disabled={locked}>
        <legend className="visually-hidden">Gründlichkeit</legend>
        {THOROUGHNESS.map((level) => (
          <label key={level} className="settings-model-label">
            <input
              type="radio"
              name="thoroughness"
              checked={current === level}
              onChange={() => void choose(level)}
            />
            <span className="settings-model-line">
              <span className="settings-model-name">{THOROUGHNESS_NAME[level]}</span>
              {levelExceedsMemory(level, ram) && (
                <span className="settings-model-note">dauert deutlich länger</span>
              )}
            </span>
          </label>
        ))}
        {current === null && (
          <label className="settings-model-label">
            <input type="radio" name="thoroughness" checked readOnly />
            <span className="settings-model-name">Eigene Auswahl</span>
          </label>
        )}
      </fieldset>
    </section>
  );
}

export function SettingsDialog() {
  const { models } = useApp();
  const { settings, transcriber, corrector, reviewer, cloud, switchLocked, setup } = models;
  const reviewerShared =
    reviewer.model.id === corrector.model.id &&
    cloud.steps.corrector === undefined &&
    cloud.steps.reviewer === undefined;
  const available = transcriber.available;
  const anyLocked = switchLocked.transcriber || switchLocked.corrector || switchLocked.reviewer;
  return (
    <Dialog open={settings.open} onClose={settings.close} title="Einstellungen" size="md">
      {available ? (
        <>
          <ThoroughnessSection locked={anyLocked} />
          <ModelSection
            role="transcriber"
            setup={transcriber}
            cloud={cloud}
            locked={switchLocked.transcriber}
            onSetup={() => setup.show(['transcriber'])}
          />
          {cloud.steps.transcriber === undefined && (
            <SecondReadingSection locked={switchLocked.transcriber} />
          )}
          <ModelSection
            role="corrector"
            setup={corrector}
            cloud={cloud}
            locked={switchLocked.corrector}
            sharedWith={reviewerShared ? 'reviewer' : null}
            onSetup={() => setup.show(['corrector'])}
          />
          <ModelSection
            role="reviewer"
            setup={reviewer}
            cloud={cloud}
            locked={switchLocked.reviewer}
            sharedWith={reviewerShared ? 'corrector' : null}
            onSetup={() => setup.show(['reviewer'])}
          />
          <DiagnosticsLog />
        </>
      ) : (
        <p className="settings-note">Modelle gibt es nur in der Desktop-App.</p>
      )}
      <WeightingSettings />
      <p className="settings-about">
        Rotstift {packageInfo.version} · {privacyNote(cloud.steps)}
      </p>
    </Dialog>
  );
}
