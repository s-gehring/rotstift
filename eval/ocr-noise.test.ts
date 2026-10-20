import { describe, expect, it } from 'vitest';
import { addNoise, charEdits, learnNoise } from './ocr-noise.ts';

describe('ocr noise', () => {
  it('lists the character edits between truth and reading', () => {
    expect(charEdits('Zusammen', 'Lusamen')).toEqual([
      { from: 'Z', to: 'L' },
      { from: 'm', to: '' },
    ]);
  });

  it('learns the share of misread words and replays it reproducibly', () => {
    const model = learnNoise([{ truth: 'eins zwei drei vier', read: 'eins zwel drei vier' }]);
    expect([model.words, model.misreadWords]).toEqual([4, 1]);
    const lines = Array.from({ length: 50 }, () => 'eins zwei drei vier');
    const noisy = addNoise(lines, model, 7);
    expect(addNoise(lines, model, 7)).toEqual(noisy);
    const changed = noisy
      .join(' ')
      .split(' ')
      .filter((word, index) => word !== lines.join(' ').split(' ')[index]);
    expect(changed.length).toBeGreaterThan(25);
    expect(changed.length).toBeLessThan(80);
  });
});
