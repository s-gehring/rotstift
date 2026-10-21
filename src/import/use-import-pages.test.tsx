// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Arbeit } from './arbeiten.ts';
import { fileKey } from './file-kind.ts';
import type { LoadResult } from './load-files.ts';
import type { ImportPage } from './pages.ts';
import { UNDO_WINDOW_MS, useImportPages } from './use-import-pages.ts';

const loadFile = vi.hoisted(() => vi.fn<(file: File) => Promise<LoadResult>>());

vi.mock('./load-files.ts', () => ({ loadFile }));
vi.mock('./pdf-documents.ts', () => ({ releasePdf: () => Promise.resolve() }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function page(id: string): ImportPage {
  return {
    id,
    fileKey: id,
    label: id,
    source: { kind: 'image', file: new File([], `${id}.png`) },
    width: 1,
    height: 1,
    rotation: 0,
    thumbnailUrl: `blob:${id}`,
  };
}

const anna: Arbeit = { id: 'anna', name: 'Anna', pages: [page('a1')] };

const probe: { hook: ReturnType<typeof useImportPages> | null } = { hook: null };
let problems: string[];
let revoked: string[];
let container: HTMLElement;
let root: Root;

function Probe() {
  const current = useImportPages({ onProblem: (text) => problems.push(text) });
  useEffect(() => {
    probe.hook = current;
  });
  return null;
}

function hook(): ReturnType<typeof useImportPages> {
  if (probe.hook === null) throw new Error('Hook nicht gerendert');
  return probe.hook;
}

beforeEach(() => {
  vi.useFakeTimers();
  problems = [];
  revoked = [];
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => void revoked.push(url));
  container = document.createElement('div');
  root = createRoot(container);
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  loadFile.mockReset();
});

describe('useImportPages', () => {
  it('keeps the thumbnails of removed pages until the undo window is over', () => {
    act(() => hook().dispatch({ type: 'add', arbeit: anna }));
    act(() => hook().dispatch({ type: 'remove-arbeit', id: 'anna' }));
    expect(hook().arbeiten).toEqual([]);
    expect(revoked).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS + 1);
    });
    expect(revoked).toEqual(['blob:a1']);
  });

  it('does not release anything when the removal is undone', () => {
    act(() => hook().dispatch({ type: 'add', arbeit: anna }));
    act(() => hook().dispatch({ type: 'remove-arbeit', id: 'anna' }));
    act(() => hook().undo());
    expect(hook().arbeiten.map((arbeit) => arbeit.name)).toEqual(['Anna']);
    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS + 1);
    });
    expect(revoked).toEqual([]);
  });

  it('releases the earlier removal when another one follows', () => {
    act(() => hook().dispatch({ type: 'add', arbeit: anna }));
    act(() =>
      hook().dispatch({ type: 'add', arbeit: { id: 'ben', name: 'Ben', pages: [page('b1')] } }),
    );
    act(() => hook().dispatch({ type: 'remove-arbeit', id: 'anna' }));
    act(() => hook().dispatch({ type: 'remove-arbeit', id: 'ben' }));
    expect(revoked).toEqual(['blob:a1']);
    act(() => hook().undo());
    expect(hook().arbeiten.map((arbeit) => arbeit.name)).toEqual(['Ben']);
  });

  it('reports one message per failed file and a summary for several', async () => {
    loadFile.mockResolvedValue({ ok: false, message: '„x.txt“ wird nicht unterstützt.' });
    await act(async () => {
      hook().addFiles([new File(['1'], 'x.txt')]);
      await vi.runAllTimersAsync();
    });
    expect(problems).toEqual(['„x.txt“ wird nicht unterstützt.']);
    problems.length = 0;
    await act(async () => {
      hook().addFiles([new File(['22'], 'y.txt'), new File(['333'], 'z.txt')]);
      await vi.runAllTimersAsync();
    });
    expect(problems).toEqual(['2 Dateien nicht geladen.']);
  });

  it('reports duplicates right away', async () => {
    const file = new File(['1'], 'dup.png');
    loadFile.mockResolvedValue({ ok: true, pages: [{ ...page('d1'), fileKey: fileKey(file) }] });
    await act(async () => {
      hook().addFiles([file]);
      await vi.runAllTimersAsync();
    });
    expect(hook().arbeiten.map((arbeit) => arbeit.name)).toEqual(['dup']);
    act(() => hook().addFiles([file]));
    expect(problems).toEqual(['„dup.png“ ist bereits geladen.']);
  });
});
