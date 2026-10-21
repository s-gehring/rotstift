import type { ModelRole } from '../app/types.ts';
import { createLlmClient, type Invoke, type LlmClient } from '../llm/client.ts';
import type { LlmEngine } from '../llm/engine.ts';
import { MAX_IMAGE_EDGE } from '../llm/image.ts';
import { template, type CorrectorInfo, type ModelInfo } from '../models/registry.ts';
import type { EngineMonitor } from '../pipeline/transcriber.ts';
import type { CloudStep, CloudView } from './client.ts';
import { findTemplate } from './templates.ts';

export function cloudLlmClient(step: ModelRole, invoke?: Invoke): LlmClient {
  return createLlmClient(invoke, {
    chat: 'cloud_chat',
    cancel: 'cloud_cancel',
    args: { step },
  });
}

const READY: EngineMonitor = { getPhase: () => 'ready', subscribe: () => () => undefined };

export function remoteEngine(): LlmEngine {
  return {
    acquire: (_model, signal) => {
      signal.throwIfAborted();
      return Promise.resolve({ startupMs: 0, release: () => undefined });
    },
    monitor: () => READY,
    markFailed: () => undefined,
    reset: () => Promise.resolve(),
    loadedModel: () => null,
  };
}

function remoteName(step: CloudStep): string {
  return `${step.label} · ${step.model}`;
}

export function remoteTranscriber(step: CloudStep): ModelInfo {
  const base = template('transcriber');
  if (base.role !== 'transcriber') throw new Error('Die Vorlage für die Erkennung fehlt.');
  return {
    ...base,
    id: 'cloud-transcriber',
    displayName: remoteName(step),
    request: { ...base.request, imageMaxEdge: MAX_IMAGE_EDGE, uncertainBelow: null },
  };
}

export function remoteCorrector(step: CloudStep, role: 'corrector' | 'reviewer'): CorrectorInfo {
  const base = template('corrector');
  if (base.role !== 'corrector') throw new Error('Die Vorlage für die Korrektur fehlt.');
  return { ...base, id: `cloud-${role}`, displayName: remoteName(step) };
}

export function cloudUsable(step: CloudStep | undefined): step is CloudStep {
  if (step === undefined || !step.confirmed) return false;
  return step.key !== null || findTemplate(step.template)?.key === 'optional';
}

export const PRIVACY_NOTE = 'Alles bleibt auf diesem Rechner.';
export const CLOUD_PRIVACY_NOTE = 'Cloud-Modelle senden Daten an Drittanbieter.';

export function privacyNote(steps: CloudView['steps']): string {
  return Object.values(steps).some((step) => !step.loopback) ? CLOUD_PRIVACY_NOTE : PRIVACY_NOTE;
}

export function cloudBlockedMessage(step: CloudStep): string {
  return step.confirmed
    ? `Für ${step.label} fehlt der Schlüssel. Bitte in den Einstellungen eingeben.`
    : `${step.label} ist nicht freigegeben. Bitte in den Einstellungen neu wählen.`;
}
