import type { Readiness, StartDecision } from './run.ts';
import type { SetupRole } from './types.ts';

export interface SecondReaderState {
  readonly available: boolean;
  readonly status: { readonly state: string } | null;
  readonly loadError: unknown;
}

export function secondReaderReadiness(setup: SecondReaderState, wanted: boolean): Readiness {
  if (!wanted || !setup.available) return 'ready';
  if (setup.status === null) return setup.loadError === null ? 'checking' : 'missing';
  return setup.status.state === 'ready' ? 'ready' : 'missing';
}

export type Decision =
  | Exclude<StartDecision, { readonly action: 'setup' }>
  | { readonly action: 'setup'; readonly roles: readonly SetupRole[] };

export function withSecondReader(decision: StartDecision, second: Readiness): Decision {
  if (decision.action === 'unavailable' || second === 'ready') return decision;
  if (second === 'missing') {
    const roles = decision.action === 'setup' ? decision.roles : [];
    return { action: 'setup', roles: [...roles, 'secondReader'] };
  }
  return decision.action === 'launch' ? { action: 'wait' } : decision;
}
