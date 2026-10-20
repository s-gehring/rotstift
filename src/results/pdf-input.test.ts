import { describe, expect, it, vi } from 'vitest';
import type { PageImageEncoder } from '../export/types.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import type { PageEntry } from '../pipeline/runner.ts';
import { createPdfInput } from './pdf-input.ts';

function page(id: string, overrides: Partial<ImportPage> = {}): ImportPage {
  return {
    id,
    fileKey: id,
    label: `${id}.png`,
    source: { kind: 'image', file: new File([], `${id}.png`) },
    width: 100,
    height: 200,
    rotation: 0,
    thumbnailUrl: `blob:${id}`,
    ...overrides,
  };
}

function entry(text: string, hasTranscript = true): PageEntry {
  return { status: 'done', text, hasTranscript, edited: false, rotation: 0, error: null };
}

const arbeit: Arbeit = {
  id: 'x',
  name: 'Anna',
  pages: [page('a'), page('b', { rotation: 90 }), page('c')],
};

const entries = { a: entry('eins zwei\ndrei'), b: entry('', false) };

describe('createPdfInput', () => {
  it('titles the Arbeit and gives every page its visible size', () => {
    const { wordCountArbeit } = createPdfInput(vi.fn(), vi.fn());
    const input = wordCountArbeit(arbeit, entries);
    expect(input.title).toBe('Anna');
    expect(input.pages.map((p) => [p.width, p.height])).toEqual([
      [100, 200],
      [200, 100],
      [100, 200],
    ]);
  });

  it('turns the transcript text into lines and leaves uncounted pages without one', () => {
    const { wordCountArbeit } = createPdfInput(vi.fn(), vi.fn());
    const input = wordCountArbeit(arbeit, entries);
    expect(input.pages[0]?.transcript?.lines.map((line) => line.text)).toEqual([
      'eins zwei',
      'drei',
    ]);
    expect(input.pages[1]?.transcript).toBeUndefined();
    expect(input.pages[2]?.transcript).toBeUndefined();
  });

  it('renders a page only when it is encoded and passes the rendering on', async () => {
    const scan = new Blob(['scan']);
    const render = vi.fn<(source: ImportPage) => Promise<Blob>>(() => Promise.resolve(scan));
    const encode = vi.fn<PageImageEncoder>(() =>
      Promise.resolve({ bytes: new Uint8Array(1), format: 'jpeg' }),
    );
    const { wordCountArbeit, encodePage } = createPdfInput(render, encode);
    const input = wordCountArbeit(arbeit, entries);
    expect(render).not.toHaveBeenCalled();

    const second = input.pages[1];
    if (second === undefined) throw new Error('missing page');
    await encodePage(second, undefined);
    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(arbeit.pages[1]);
    expect(encode).toHaveBeenCalledWith({ ...second, image: scan }, undefined);
  });

  it('uses the image of a page it did not create', async () => {
    const render = vi.fn<(source: ImportPage) => Promise<Blob>>();
    const encode = vi.fn<PageImageEncoder>(() =>
      Promise.resolve({ bytes: new Uint8Array(1), format: 'jpeg' }),
    );
    const { encodePage } = createPdfInput(render, encode);
    const image = new Blob(['x']);
    await encodePage({ image, width: 1, height: 1 }, undefined);
    expect(render).not.toHaveBeenCalled();
    expect(encode).toHaveBeenCalledWith({ image, width: 1, height: 1 }, undefined);
  });
});
