import { describe, expect, it, vi } from 'vitest';
import type { Detector, DetectorContext, PrivacySpan } from '../privacy/types.ts';
import { createDetectWork } from './detect.ts';

const context: DetectorContext = { workName: 'x', language: 'de' };
const signal = new AbortController().signal;

const person = (line: number, offset: number, length: number): PrivacySpan => ({
  kind: 'identifier',
  category: 'person',
  source: 'model',
  line,
  offset,
  length,
});

const finding =
  (...spans: PrivacySpan[]): Detector =>
  async () =>
    spans;

const failing: Detector = async () => {
  throw new Error('boom');
};

const pages = [
  { pageId: 'a', lines: ['Zorbek kam.', 'Nichts.'] },
  { pageId: 'b', lines: ['Dann ging Quandt.'] },
  { pageId: 'c', lines: ['Ende.'] },
];

describe('createDetectWork', () => {
  it('runs each detector once over the lines of all pages', async () => {
    const detector = vi.fn<Detector>(async () => []);
    await createDetectWork([detector])(pages, context, signal);
    expect(detector).toHaveBeenCalledTimes(1);
    expect(detector.mock.calls[0]?.[0]).toEqual([
      'Zorbek kam.',
      'Nichts.',
      'Dann ging Quandt.',
      'Ende.',
    ]);
    expect(detector.mock.calls[0]?.[1]).toBe(context);
  });

  it('splits spans back per page with page-relative line numbers', async () => {
    const detector = finding(person(1, 0, 6), person(3, 10, 6));
    const result = await createDetectWork([detector])(pages, context, signal);
    expect(result.map((page) => page.pageId)).toEqual(['a', 'b', 'c']);
    expect(result.map((page) => page.lines)).toEqual(pages.map((page) => page.lines));
    expect(result[0]?.spans.map((span) => [span.line, span.offset])).toEqual([[1, 0]]);
    expect(result[1]?.spans.map((span) => [span.line, span.offset])).toEqual([[1, 10]]);
    expect(result[2]?.spans).toEqual([]);
  });

  it('combines the spans of several detectors', async () => {
    const first = finding(person(1, 0, 6));
    const second = finding(person(3, 10, 6));
    const result = await createDetectWork([first, second])(pages, context, signal);
    expect(result.map((page) => page.spans.length)).toEqual([1, 1, 0]);
  });

  it('propagates a found name to other pages', async () => {
    const detector = finding(person(1, 0, 6));
    const result = await createDetectWork([detector])(
      [
        { pageId: 'a', lines: ['Zorbek kam.'] },
        { pageId: 'b', lines: ['Später sah ich Zorbek wieder.'] },
      ],
      context,
      signal,
    );
    expect(result[1]?.spans.map((span) => [span.line, span.offset, span.length])).toEqual([
      [1, 15, 6],
    ]);
  });

  it('returns pages without spans for no detectors', async () => {
    const result = await createDetectWork([])(pages, context, signal);
    expect(result.map((page) => page.spans)).toEqual([[], [], []]);
  });

  it('accepts detectors as an async factory', async () => {
    const detector = vi.fn<Detector>(async () => [person(3, 10, 6)]);
    const factory = vi.fn<() => Promise<Detector[]>>(async () => [detector]);
    const result = await createDetectWork(factory)(pages, context, signal);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(detector).toHaveBeenCalledTimes(1);
    expect(result[1]?.spans).toHaveLength(1);
  });

  it('resolves the factory on every call', async () => {
    const factory = vi.fn<() => Promise<Detector[]>>(async () => []);
    const work = createDetectWork(factory);
    await work(pages, context, signal);
    await work(pages, context, signal);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('rejects when aborted before running', async () => {
    const controller = new AbortController();
    controller.abort();
    const detector = vi.fn<Detector>(async () => []);
    await expect(createDetectWork([detector])(pages, context, controller.signal)).rejects.toThrow(
      /abort/i,
    );
    expect(detector).not.toHaveBeenCalled();
  });

  it('rejects when a detector fails', async () => {
    await expect(createDetectWork([failing])(pages, context, signal)).rejects.toThrow('boom');
  });
});
