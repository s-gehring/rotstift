import { describe, expect, it, vi } from 'vitest';
import { incompletePagesNote } from '../export/notes.ts';
import type { PageImageEncoder } from '../export/types.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import type { PageEntry } from '../pipeline/runner.ts';
import { formatCsv } from './export-table.ts';
import { createPdfInput } from './pdf-input.ts';
import { buildResults } from './summary.ts';

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
  return {
    status: 'done',
    text,
    hasTranscript,
    edited: false,
    rotation: 0,
    error: null,
    reading: null,
  };
}

const arbeit: Arbeit = {
  id: 'x',
  name: 'Anna',
  pages: [page('a'), page('b', { rotation: 90 }), page('c')],
};

const entries = { a: entry('eins zwei\ndrei'), b: entry('', false) };

function resultOf(target: Arbeit, pageEntries: Record<string, PageEntry>) {
  const [result] = buildResults([target], pageEntries);
  if (result === undefined) throw new Error('missing result');
  return result;
}

describe('createPdfInput', () => {
  it('titles the Arbeit and gives every page its visible size', () => {
    const { wordCountArbeit } = createPdfInput(vi.fn(), vi.fn());
    const input = wordCountArbeit(arbeit, resultOf(arbeit, entries));
    expect(input.title).toBe('Anna');
    expect(input.pages.map((p) => [p.width, p.height])).toEqual([
      [100, 200],
      [200, 100],
      [100, 200],
    ]);
  });

  it('passes the words of the view and leaves uncounted pages open', () => {
    const { wordCountArbeit } = createPdfInput(vi.fn(), vi.fn());
    const input = wordCountArbeit(arbeit, resultOf(arbeit, entries));
    expect(input.words).toEqual([3, null, null]);
  });

  it('removes a word that is hyphenated across the page boundary, as the CSV does', () => {
    const split: Arbeit = { id: 'y', name: 'Ben', pages: [page('p1'), page('p2')] };
    const pageEntries = {
      p1: entry('Wir gingen in den Wald und sam-'),
      p2: entry('melten Blätter'),
    };
    const result = resultOf(split, pageEntries);
    const { wordCountArbeit } = createPdfInput(vi.fn(), vi.fn());
    const words = wordCountArbeit(split, result).words ?? [];
    const pdfTotal = words.reduce<number>((sum, count) => sum + (count ?? 0), 0);
    expect(pdfTotal).toBe(8);
    expect(formatCsv([result])).toContain('Ben;2;8;');
    expect(pdfTotal).toBe(result.words);
  });

  it('describes an incomplete count like the CSV', () => {
    const result = resultOf(arbeit, entries);
    expect(formatCsv([result])).toContain(incompletePagesNote(1, 3));
  });

  it('renders a page only when it is encoded and passes the rendering on', async () => {
    const scan = new Blob(['scan']);
    const render = vi.fn<(source: ImportPage) => Promise<Blob>>(() => Promise.resolve(scan));
    const encode = vi.fn<PageImageEncoder>(() =>
      Promise.resolve({ bytes: new Uint8Array(1), format: 'jpeg' }),
    );
    const { wordCountArbeit, encodePage } = createPdfInput(render, encode);
    const input = wordCountArbeit(arbeit, resultOf(arbeit, entries));
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
