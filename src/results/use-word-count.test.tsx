// @vitest-environment happy-dom
import { StrictMode, act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportPage } from '../import/pages.ts';
import type { PageTranscriber, TranscriberStatus } from '../pipeline/transcriber.ts';
import { useWordCount, type WordCount } from './use-word-count.ts';

vi.mock('../import/render-page.ts', () => ({
  renderPageToPng: (page: ImportPage) => Promise.resolve(new Blob([page.id])),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const page: ImportPage = {
  id: 'a',
  fileKey: 'a',
  label: 'a.png',
  source: { kind: 'image', file: new File([], 'a.png') },
  width: 10,
  height: 10,
  rotation: 0,
  thumbnailUrl: 'blob:a',
};

const pages = [page];

function readyStatus(): { status: TranscriberStatus; signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  const transcriber: PageTranscriber = {
    transcribe: (_png, signal, onPhase) => {
      signals.push(signal);
      onPhase?.('request');
      return Promise.resolve({ ok: true, lines: ['Hallo Welt'] });
    },
  };
  return { status: { state: 'ready', transcriber, demo: false }, signals };
}

function hangingStatus(): { status: TranscriberStatus; signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  const transcriber: PageTranscriber = {
    transcribe: (_png, signal, onPhase) => {
      signals.push(signal);
      onPhase?.('request');
      return new Promise(() => undefined);
    },
  };
  return { status: { state: 'ready', transcriber, demo: false }, signals };
}

let container: HTMLElement;
let root: Root;
let latest: WordCount | null = null;

function Probe({ status }: { status: TranscriberStatus }) {
  const result = useWordCount(pages, status);
  useEffect(() => {
    latest = result;
  });
  return null;
}

const settle = () => act(async () => vi.advanceTimersByTimeAsync(10));

describe('useWordCount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    root = createRoot(container);
    latest = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts a page when rendered in StrictMode', async () => {
    const { status } = readyStatus();
    await act(async () => {
      root.render(
        <StrictMode>
          <Probe status={status} />
        </StrictMode>,
      );
    });
    act(() => {
      latest?.runner.start();
    });
    await settle();
    expect(latest?.state.entries['a']).toMatchObject({ status: 'done', text: 'Hallo Welt' });
    await act(async () => {
      root.unmount();
    });
  });

  it('aborts the running page and clears timers on a real unmount', async () => {
    const { status, signals } = hangingStatus();
    await act(async () => {
      root.render(
        <StrictMode>
          <Probe status={status} />
        </StrictMode>,
      );
    });
    act(() => {
      latest?.runner.start();
    });
    await settle();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    await act(async () => {
      root.unmount();
    });
    await settle();
    expect(signals[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
