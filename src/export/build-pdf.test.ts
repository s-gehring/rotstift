// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEUTSCH, ENGLISCH } from '../annotations/profile.ts';
import type { Transcript } from '../annotations/transcript.ts';
import { computeStatistics } from '../stats/statistics.ts';
import { buildClassPdf, buildCorrectedPdf, buildWordCountPdf } from './build-pdf.ts';
import {
  bareScan,
  correctedArbeit,
  FIXED_DATE,
  LANDSCAPE,
  markedPage,
  plainTranscript,
  wordCountArbeit,
} from './fixtures.ts';
import { installCanvas, readPdf, syntheticScan } from './test-support.ts';
import type { ClassArbeit, PageImageEncoder } from './types.ts';

vi.mock('../import/canvas.ts', () => import('./test-support.ts').then((m) => m.canvasModule));
vi.mock('../overlay/font.ts', () => import('./test-support.ts').then((m) => m.fontModule));

vi.setConfig({ testTimeout: 30_000 });

beforeAll(installCanvas);

const options = { date: FIXED_DATE };
const PORTRAIT = [595.28, 841.89];
const LANDSCAPE_A4 = [841.89, 595.28];

describe('buildCorrectedPdf', () => {
  it('holds the pages in A4 followed by the statistics page', async () => {
    const arbeit = await correctedArbeit();
    const pdf = await readPdf(await buildCorrectedPdf(arbeit, options));
    expect(pdf.pageCount).toBe(4);
    expect(pdf.sizes).toEqual([PORTRAIT, PORTRAIT, PORTRAIT, PORTRAIT]);
    expect(pdf.images.map((images) => images.length)).toEqual([1, 1, 1, 0]);
    expect(pdf.images[0]?.[0]?.[0]).toBeGreaterThan(1000);
  });

  it('keeps the orientation of a landscape page', async () => {
    const arbeit = await correctedArbeit();
    const pages = [...arbeit.pages, await bareScan(LANDSCAPE)];
    const pdf = await readPdf(await buildCorrectedPdf({ ...arbeit, pages }, options));
    expect(pdf.sizes[3]).toEqual(LANDSCAPE_A4);
    expect(pdf.sizes[4]).toEqual(PORTRAIT);
  });

  it('shows words, errors, errors per type, rate, profile and date in German', async () => {
    const arbeit = await correctedArbeit();
    const { statistics } = arbeit;
    const text = (await readPdf(await buildCorrectedPdf(arbeit, options))).texts[3] ?? '';
    expect(text).toContain('AUSWERTUNG');
    expect(text).toContain('Müller, Jörg');
    expect(text).toContain('Profil Deutsch Datum');
    expect(text).toContain('Datum 20.10.2026');
    expect(text).toMatch(new RegExp(`Wörter ${statistics.words}\\b`));
    expect(text).toMatch(new RegExp(`Fehler gesamt ${statistics.errors}\\b`));
    const rate = statistics.errorsPer100Words.toFixed(1).replace('.', ',');
    expect(text).toContain(`Fehler pro 100 Wörter ${rate}`);
    expect(text).toContain('Rechtschreibung');
    expect(text).toContain('Zeichensetzung');
    for (const [code, count] of Object.entries(statistics.errorsByType)) {
      expect(text).toMatch(new RegExp(`\\b${code} \\S.* ${count}\\b`));
    }
  });

  it('uses the catalog of the profile language', async () => {
    const transcript: Transcript = {
      lines: [
        {
          number: 1,
          bbox: { x: 150, y: 260, width: 860, height: 60 },
          text: 'I goed home now',
          marks: [{ kind: 'error', type: 'voc', original: 'goed', correction: 'went', offset: 2 }],
        },
      ],
    };
    const page = await markedPage(transcript);
    const statistics = computeStatistics(transcript);
    const arbeit = { title: 'Doe, Jane', profile: ENGLISCH, pages: [page], statistics };
    const text = (await readPdf(await buildCorrectedPdf(arbeit, options))).texts[1] ?? '';
    expect(text).toContain('Englisch');
    expect(text).toContain('Fehler pro 100 Wörter 25,0');
    expect(text).not.toContain('Rechtschreibung');
  });

  it('says so when there are no errors', async () => {
    const transcript = plainTranscript('Eins zwei drei vier');
    const page = await markedPage(transcript);
    const statistics = computeStatistics(transcript);
    const arbeit = { title: 'Fehlerfrei', profile: DEUTSCH, pages: [page], statistics };
    const pdf = await readPdf(await buildCorrectedPdf(arbeit, options));
    expect(pdf.texts[1]).toContain('Keine Fehler markiert.');
  });

  it.each([
    ['the error count', { errors: 99 }],
    ['the error types', { errorsByType: { Z: 1 } }],
    ['the word count', { words: 1 }],
  ])('rejects statistics that contradict %s of the transcripts', async (_name, change) => {
    const arbeit = await correctedArbeit();
    const statistics = { ...arbeit.statistics, ...change };
    await expect(buildCorrectedPdf({ ...arbeit, statistics }, options)).rejects.toThrow(
      'passt nicht zu den Transkripten',
    );
  });

  it('renders umlauts and falls back for letters outside WinAnsi', async () => {
    const arbeit = await correctedArbeit('Übung: Größe, Ärger – Łukasz Çağlar');
    const pdf = await buildCorrectedPdf(arbeit, options);
    const text = (await readPdf(pdf)).texts[3] ?? '';
    expect(text).toContain('Übung: Größe, Ärger – Lukasz Çaglar');
  });

  it('rejects an Arbeit without pages', async () => {
    const arbeit = await correctedArbeit();
    await expect(buildCorrectedPdf({ ...arbeit, pages: [] }, options)).rejects.toThrow(
      'keine Seiten',
    );
  });

  it('writes the title into the metadata', async () => {
    const arbeit = await correctedArbeit();
    const pdf = await readPdf(await buildCorrectedPdf(arbeit, options));
    expect(pdf.title).toBe('Müller, Jörg');
  });
});

const tiny = syntheticScan({ width: 120, height: 170 }, undefined, 'jpeg');
const cheapEncoder: PageImageEncoder = async () => ({
  bytes: new Uint8Array(await (await tiny).arrayBuffer()),
  format: 'jpeg',
});
const cheap = { ...options, encodePage: cheapEncoder };

describe('buildWordCountPdf', () => {
  it('holds the original pages and a summary with words per page and in total', async () => {
    const arbeit = await wordCountArbeit();
    const pdf = await readPdf(await buildWordCountPdf(arbeit, options));
    expect(pdf.pageCount).toBe(4);
    expect(pdf.images.map((images) => images.length)).toEqual([1, 1, 1, 0]);
    const text = pdf.texts[3] ?? '';
    expect(text).toContain('WORTZAHL');
    expect(text).toContain('Schmidt, Anna');
    expect(text).toContain('Wörter gesamt 9');
    expect(text).toContain('Seite 1 6');
    expect(text).toContain('Seite 2 –');
    expect(text).toContain('Seite 3 3');
    expect(text).toContain('Gesamt 9');
  });

  it('continues the table on a new page for long Arbeiten', async () => {
    const page = (await wordCountArbeit()).pages[0];
    if (page === undefined) throw new Error('missing page');
    const pdf = await readPdf(
      await buildWordCountPdf({ title: 'Lang', pages: Array(45).fill(page) }, cheap),
    );
    expect(pdf.pageCount).toBe(45 + 2);
    expect(pdf.texts[46]).toContain('Gesamt');
    expect(pdf.texts[46]).toContain('Seite 45');
  });
});

async function mixed(): Promise<ClassArbeit[]> {
  return [
    { kind: 'corrected', ...(await correctedArbeit('Müller, Jörg')) },
    { kind: 'wordCount', ...(await wordCountArbeit('Schmidt, Anna')) },
  ];
}

describe('buildClassPdf', () => {
  it('puts a cover page with all names and counts in front of every Arbeit', async () => {
    const arbeiten = await mixed();
    const pdf = await readPdf(await buildClassPdf(arbeiten, { ...options, title: 'Klasse 7b' }));
    expect(pdf.pageCount).toBe(1 + 4 + 4);
    expect(pdf.images.map((images) => images.length)).toEqual([0, 1, 1, 1, 0, 1, 1, 1, 0]);
    const cover = pdf.texts[0] ?? '';
    const corrected = arbeiten[0];
    if (corrected?.kind !== 'corrected') throw new Error('unexpected kind');
    expect(cover).toContain('KLASSENÜBERSICHT');
    expect(cover).toContain('Klasse 7b');
    expect(cover).toContain(
      `Müller, Jörg 3 ${corrected.statistics.words} ${corrected.statistics.errors}`,
    );
    expect(cover).toContain('Schmidt, Anna 3 9 –');
    expect(pdf.texts[4]).toContain('AUSWERTUNG');
    expect(pdf.texts[8]).toContain('WORTZAHL');
  });

  it('continues the cover on further pages for big classes', async () => {
    const [first] = await mixed();
    if (first === undefined) throw new Error('missing Arbeit');
    const arbeiten = Array.from({ length: 40 }, (_, index) => ({
      ...first,
      title: `Schüler ${index + 1}`,
    }));
    const pdf = await readPdf(await buildClassPdf(arbeiten, cheap));
    expect(pdf.pageCount).toBe(2 + 40 * 4);
    expect(pdf.texts[0]).toContain('Schüler 1 ');
    expect(pdf.texts[1]).toContain('Schüler 40 ');
  });

  it('rejects an empty class', async () => {
    await expect(buildClassPdf([], options)).rejects.toThrow('keine Arbeiten');
  });

  it('reports progress per page and yields to the event loop between pages', async () => {
    const arbeiten = await mixed();
    const progress: [number, number][] = [];
    let yielded = false;
    setTimeout(() => {
      yielded = true;
    }, 0);
    const seen: boolean[] = [];
    await buildClassPdf(arbeiten, {
      ...cheap,
      onProgress: (done, total) => {
        progress.push([done, total]);
        seen.push(yielded);
      },
    });
    expect(progress).toEqual(Array.from({ length: 6 }, (_, index) => [index + 1, 6]));
    expect(seen[1]).toBe(true);
  });

  it('stops when aborted and does not encode further pages', async () => {
    const arbeiten = await mixed();
    const controller = new AbortController();
    let encoded = 0;
    const promise = buildClassPdf(arbeiten, {
      ...options,
      signal: controller.signal,
      encodePage: async (page, profile) => {
        encoded += 1;
        return cheapEncoder(page, profile);
      },
      onProgress: (done) => {
        if (done === 2) controller.abort(new Error('Abgebrochen'));
      },
    });
    await expect(promise).rejects.toThrow('Abgebrochen');
    expect(encoded).toBe(2);
  });

  it('does not start when the signal is already aborted', async () => {
    const arbeiten = await mixed();
    const signal = AbortSignal.abort(new Error('Gleich abgebrochen'));
    await expect(buildClassPdf(arbeiten, { ...cheap, signal })).rejects.toThrow(
      'Gleich abgebrochen',
    );
  });
});
