// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { correctedArbeit, FIXED_DATE, wordCountArbeit } from './fixtures.ts';
import { decodedHeader, fakeInvoke } from './fake-invoke.ts';
import { saveClassPdf, saveCorrectedPdf, saveWordCountPdf } from './save-pdf.ts';
import { installCanvas, readPdf, syntheticScan } from './test-support.ts';
import type { ClassArbeit, PageImageEncoder } from './types.ts';

vi.mock('../import/canvas.ts', () => import('./test-support.ts').then((m) => m.canvasModule));
vi.mock('../overlay/font.ts', () => import('./test-support.ts').then((m) => m.fontModule));

vi.setConfig({ testTimeout: 30_000 });

beforeAll(installCanvas);

const tiny = syntheticScan({ width: 120, height: 170 }, undefined, 'jpeg');
const cheapEncoder: PageImageEncoder = async () => ({
  bytes: new Uint8Array(await (await tiny).arrayBuffer()),
  format: 'jpeg',
});
const cheap = { date: FIXED_DATE, encodePage: cheapEncoder };

async function klasse(): Promise<ClassArbeit[]> {
  return [
    { kind: 'wordCount', ...(await wordCountArbeit('Anna')) },
    { kind: 'corrected', ...(await correctedArbeit('Ben')) },
  ];
}

describe('saveWordCountPdf', () => {
  it('hands the finished PDF to save_file with kind pdf and a suggested name', async () => {
    const { calls, invoke } = fakeInvoke({ fileName: 'Datei.pdf' });
    const outcome = await saveWordCountPdf(await wordCountArbeit('Müller, Jörg'), {
      ...cheap,
      invoke,
    });
    expect(outcome).toEqual({ state: 'saved', fileName: 'Datei.pdf' });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.command).toBe('save_file');
    expect(decodedHeader(call, 'x-rotstift-kind')).toBe('pdf');
    expect(decodedHeader(call, 'x-rotstift-name')).toBe('Müller, Jörg (Wortzahl)');
    const bytes = call?.body ?? new Uint8Array();
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
    expect((await readPdf(bytes)).pageCount).toBe(4);
  });

  it('reports a cancelled save dialog', async () => {
    const { invoke } = fakeInvoke(null);
    expect(await saveWordCountPdf(await wordCountArbeit(), { ...cheap, invoke })).toEqual({
      state: 'cancelled',
    });
  });

  it('reports a file that already exists', async () => {
    const { invoke } = fakeInvoke({ kind: 'alreadyExists', fileName: 'a.pdf' }, true);
    expect(await saveWordCountPdf(await wordCountArbeit(), { ...cheap, invoke })).toEqual({
      state: 'exists',
      fileName: 'a.pdf',
    });
  });

  it('reports a failing save command', async () => {
    const { invoke } = fakeInvoke({ kind: 'io', message: 'voll' }, true);
    expect(await saveWordCountPdf(await wordCountArbeit(), { ...cheap, invoke })).toEqual({
      state: 'failed',
    });
  });

  it('fails without asking for a location when the PDF cannot be built', async () => {
    const { calls, invoke } = fakeInvoke({ fileName: 'Datei.pdf' });
    const outcome = await saveWordCountPdf({ title: 'Leer', pages: [] }, { ...cheap, invoke });
    expect(outcome).toEqual({ state: 'failed' });
    expect(calls).toHaveLength(0);
  });

  it('reports that saving is unavailable outside the desktop app', async () => {
    expect(await saveWordCountPdf(await wordCountArbeit(), cheap)).toEqual({
      state: 'unavailable',
    });
  });
});

describe('saveCorrectedPdf', () => {
  it('saves the corrected work with its statistics page', async () => {
    const { calls, invoke } = fakeInvoke({ fileName: 'Datei.pdf' });
    const outcome = await saveCorrectedPdf(await correctedArbeit('Anna'), { ...cheap, invoke });
    expect(outcome.state).toBe('saved');
    expect(decodedHeader(calls[0], 'x-rotstift-name')).toBe('Anna (korrigiert)');
    expect((await readPdf(calls[0]?.body ?? new Uint8Array())).pageCount).toBe(4);
  });
});

describe('saveClassPdf', () => {
  it('saves one PDF for the class and reports progress per page', async () => {
    const { calls, invoke } = fakeInvoke({ fileName: 'Datei.pdf' });
    const progress: [number, number][] = [];
    const outcome = await saveClassPdf(await klasse(), {
      ...cheap,
      invoke,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(outcome.state).toBe('saved');
    expect(progress).toEqual(Array.from({ length: 6 }, (_, index) => [index + 1, 6]));
    expect(decodedHeader(calls[0], 'x-rotstift-name')).toBe('Alle Arbeiten');
    expect((await readPdf(calls[0]?.body ?? new Uint8Array())).pageCount).toBe(1 + 4 + 4);
  });

  it('uses the given title as the suggested name', async () => {
    const { calls, invoke } = fakeInvoke({ fileName: 'Datei.pdf' });
    await saveClassPdf(await klasse(), { ...cheap, invoke, title: 'Klasse 8b' });
    expect(decodedHeader(calls[0], 'x-rotstift-name')).toBe('Klasse 8b');
  });

  it('is cancelled by the signal without ever asking for a location', async () => {
    const { calls, invoke } = fakeInvoke({ fileName: 'Datei.pdf' });
    const controller = new AbortController();
    let encoded = 0;
    const outcome = await saveClassPdf(await klasse(), {
      ...cheap,
      invoke,
      signal: controller.signal,
      encodePage: (page, profile) => {
        encoded += 1;
        return cheap.encodePage(page, profile);
      },
      onProgress: (done) => {
        if (done === 2) controller.abort();
      },
    });
    expect(outcome).toEqual({ state: 'cancelled' });
    expect(encoded).toBe(2);
    expect(calls).toHaveLength(0);
  });

  it('is cancelled when the signal is aborted before the start', async () => {
    const { calls, invoke } = fakeInvoke({ fileName: 'Datei.pdf' });
    const outcome = await saveClassPdf(await klasse(), {
      ...cheap,
      invoke,
      signal: AbortSignal.abort(),
    });
    expect(outcome).toEqual({ state: 'cancelled' });
    expect(calls).toHaveLength(0);
  });

  it('fails for an empty class', async () => {
    const { invoke } = fakeInvoke({ fileName: 'Datei.pdf' });
    expect(await saveClassPdf([], { ...cheap, invoke })).toEqual({ state: 'failed' });
  });
});
