import type { Corrector, CorrectResult } from '../correction/corrector.ts';
import { createLlmCorrector, type CorrectorConfig } from '../correction/llm-corrector.ts';
import type { CorrectorInfo } from '../models/registry.ts';
import type { EngineMonitor } from '../pipeline/transcriber.ts';
import { createLlmClient, LlmCallError, type LlmClient } from './client.ts';
import { sharedEngine, type EngineLease, type LlmEngine } from './engine.ts';

export interface SidecarCorrectorOptions {
  readonly engine?: LlmEngine;
  readonly client?: Pick<LlmClient, 'complete'>;
  readonly onUnavailable?: () => void;
}

export type SidecarCorrector = Corrector & { readonly engine: EngineMonitor };

export function correctorConfig(model: CorrectorInfo): CorrectorConfig {
  return {
    ...(model.system !== undefined && { system: model.system }),
    promptTemplate: model.prompt,
    lineMode: model.lineMode,
    maxOutputTokens: model.request.maxOutputTokens,
    temperature: model.request.temperature,
  };
}

export function createSidecarCorrector(
  model: CorrectorInfo,
  options: SidecarCorrectorOptions = {},
): SidecarCorrector {
  const engine = options.engine ?? sharedEngine();
  const client = options.client ?? createLlmClient();
  const config = correctorConfig(model);
  const watched: Pick<LlmClient, 'complete'> = {
    async complete(request, chatOptions) {
      try {
        return await client.complete(request, chatOptions);
      } catch (error) {
        if (error instanceof LlmCallError && error.error.kind === 'exitedUnexpectedly') {
          engine.markFailed(model.id);
        }
        throw error;
      }
    },
  };

  return {
    engine: engine.monitor(model.id),

    async correct(lines, profile, signal, scope): Promise<CorrectResult> {
      const leases: EngineLease[] = [];
      const corrector = createLlmCorrector({
        client: watched,
        config,
        prepare: async (prepareSignal) => {
          leases.push(await engine.acquire(model, prepareSignal));
        },
      });
      try {
        const result = await corrector.correct(lines, profile, signal, scope);
        if (!result.ok && result.error.kind === 'unavailable') options.onUnavailable?.();
        return result;
      } finally {
        for (const lease of leases) lease.release();
      }
    },
  };
}
