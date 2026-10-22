import { describe, expect, it } from 'vitest';
import { secondReaderReadiness, withSecondReader } from './second-reading.ts';

const setup = (state: string | null, loadError: unknown = null, available = true) => ({
  available,
  status: state === null ? null : { state },
  loadError,
});

describe('secondReaderReadiness', () => {
  it('counts as ready while the second reading is off or outside the desktop app', () => {
    expect(secondReaderReadiness(setup('missing'), false)).toBe('ready');
    expect(secondReaderReadiness(setup('missing', null, false), true)).toBe('ready');
  });

  it('follows the state of the model once the second reading is on', () => {
    expect(secondReaderReadiness(setup('ready'), true)).toBe('ready');
    expect(secondReaderReadiness(setup('missing'), true)).toBe('missing');
    expect(secondReaderReadiness(setup('corrupt'), true)).toBe('missing');
    expect(secondReaderReadiness(setup(null), true)).toBe('checking');
    expect(secondReaderReadiness(setup(null, { kind: 'network' }), true)).toBe('missing');
  });
});

describe('withSecondReader', () => {
  it('leaves the decision alone while the second reader is ready or nothing can run', () => {
    expect(withSecondReader({ action: 'launch' }, 'ready')).toEqual({ action: 'launch' });
    expect(withSecondReader({ action: 'unavailable' }, 'missing')).toEqual({
      action: 'unavailable',
    });
  });

  it('adds the second reader to the models to set up', () => {
    expect(withSecondReader({ action: 'launch' }, 'missing')).toEqual({
      action: 'setup',
      roles: ['secondReader'],
    });
    expect(withSecondReader({ action: 'setup', roles: ['corrector'] }, 'missing')).toEqual({
      action: 'setup',
      roles: ['corrector', 'secondReader'],
    });
    expect(withSecondReader({ action: 'wait' }, 'missing')).toEqual({
      action: 'setup',
      roles: ['secondReader'],
    });
  });

  it('waits for the check of the second reader before a launch', () => {
    expect(withSecondReader({ action: 'launch' }, 'checking')).toEqual({ action: 'wait' });
    expect(withSecondReader({ action: 'setup', roles: ['transcriber'] }, 'checking')).toEqual({
      action: 'setup',
      roles: ['transcriber'],
    });
  });
});
