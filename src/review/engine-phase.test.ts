import { describe, expect, it } from 'vitest';
import { engineText } from './engine-phase.ts';

const run = (phase: 'transcribing' | 'locating' | 'correcting') => ({
  phase,
  total: 2,
  finished: 0,
});

describe('engineText', () => {
  it('names the model that is being loaded', () => {
    expect(engineText(run('transcribing'), { transcriber: 'starting', corrector: 'idle' })).toBe(
      'Texterkennung wird geladen …',
    );
    expect(engineText(run('correcting'), { transcriber: 'idle', corrector: 'starting' })).toBe(
      'Korrekturmodell wird geladen …',
    );
  });

  it('says that the models are being switched while the other model still holds the engine', () => {
    expect(engineText(run('transcribing'), { transcriber: 'idle', corrector: 'ready' })).toBe(
      'Modellwechsel wird vorbereitet …',
    );
    expect(engineText(run('correcting'), { transcriber: 'ready', corrector: 'idle' })).toBe(
      'Modellwechsel wird vorbereitet …',
    );
  });

  it('stays quiet once the right model runs or while lines are located', () => {
    expect(engineText(run('correcting'), { transcriber: 'idle', corrector: 'ready' })).toBeNull();
    expect(engineText(run('transcribing'), { transcriber: 'idle', corrector: 'idle' })).toBeNull();
    expect(engineText(run('locating'), { transcriber: 'ready', corrector: 'idle' })).toBeNull();
  });
});
