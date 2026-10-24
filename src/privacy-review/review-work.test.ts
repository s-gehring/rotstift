import { describe, expect, it } from 'vitest';
import type { PrivacySpan } from '../privacy/types.ts';
import { createDetectWork, detectWork } from './detect.ts';
import {
  addIdentifier,
  dropPages,
  removeIdentifier,
  reviewText,
  type PrivacyWork,
} from './review-work.ts';

const signal = new AbortController().signal;

const sensitive: PrivacySpan = {
  kind: 'sensitive',
  category: 'health',
  source: 'model',
  line: 2,
  offset: 14,
  length: 6,
};

async function work(): Promise<PrivacyWork> {
  const pages = await detectWork(
    [
      { pageId: 'p1', lines: ['Ich bin Mia Schulz.', 'Mia hatte die Grippe.'] },
      { pageId: 'p2', lines: ['Udo und Mia, Tel. 0561 123456.'] },
    ],
    { workName: 'Mia Schulz', language: 'de' },
    signal,
  );
  return {
    id: 'w1',
    name: 'Mia Schulz',
    status: 'open',
    pages: pages.map((page) =>
      page.pageId === 'p1' ? { ...page, spans: [...page.spans, sensitive] } : page,
    ),
    removed: [],
    message: null,
  };
}

function shown(entry: PrivacyWork): string[] {
  return reviewText(entry).flatMap((page) =>
    page.lines.map((line) =>
      line.segments
        .map((segment) => {
          if (segment.kind === 'identifier') return `<${segment.text}=${segment.placeholder}>`;
          if (segment.kind === 'sensitive') return `{${segment.text}:${segment.category}}`;
          return segment.text;
        })
        .join(''),
    ),
  );
}

describe('privacy review work', () => {
  it('shows identifiers with their placeholder and sensitive data as a warning', async () => {
    expect(shown(await work())).toEqual([
      'Ich bin <Mia Schulz=[Person 1]>.',
      '<Mia=[Person 2]> hatte die {Grippe:health}.',
      'Udo und <Mia=[Person 2]>, Tel. <0561 123456=[Kontakt 1]>.',
    ]);
  });

  it('adds a teacher identifier and passes it on to every occurrence', async () => {
    const added = addIdentifier(await work(), 'p2', { line: 1, offset: 0, length: 4 }, 'person');
    expect(shown(added)[2]).toBe(
      '<Udo=[Person 3]> und <Mia=[Person 2]>, Tel. <0561 123456=[Kontakt 1]>.',
    );
  });

  it('replaces a sensitive warning once the teacher marks it', async () => {
    const added = addIdentifier(await work(), 'p1', { line: 2, offset: 14, length: 6 }, 'number');
    expect(shown(added)[1]).toBe('<Mia=[Person 2]> hatte die <Grippe=[Nummer 1]>.');
  });

  it('removes every occurrence of an identifier and keeps it removed after an addition', async () => {
    const removed = removeIdentifier(await work(), 'p1', { line: 2, offset: 0, length: 3 });
    expect(removed.removed).toEqual(['mia']);
    expect(shown(removed)[2]).toBe('Udo und Mia, Tel. <0561 123456=[Kontakt 1]>.');

    const added = addIdentifier(removed, 'p2', { line: 1, offset: 0, length: 3 }, 'person');
    expect(shown(added)).toEqual([
      'Ich bin <Mia Schulz=[Person 1]>.',
      'Mia hatte die {Grippe:health}.',
      '<Udo=[Person 2]> und Mia, Tel. <0561 123456=[Kontakt 1]>.',
    ]);

    const again = addIdentifier(added, 'p2', { line: 1, offset: 8, length: 3 }, 'person');
    expect(again.removed).toEqual([]);
    expect(shown(again).slice(1)).toEqual([
      '<Mia=[Person 2]> hatte die {Grippe:health}.',
      '<Udo=[Person 3]> und <Mia=[Person 2]>, Tel. <0561 123456=[Kontakt 1]>.',
    ]);
  });

  it('trims a selection and ignores an empty one', async () => {
    const before = await work();
    expect(addIdentifier(before, 'p2', { line: 1, offset: 3, length: 1 }, 'person')).toBe(before);
    const added = addIdentifier(before, 'p2', { line: 1, offset: 0, length: 4 }, 'person');
    expect(added.pages[1]?.spans).toContainEqual(
      expect.objectContaining({ source: 'teacher', offset: 0, length: 3 }),
    );
  });

  it('takes back a full name with its parts in one click and adds them back together', async () => {
    const figure: PrivacySpan = {
      kind: 'identifier',
      category: 'person',
      source: 'model',
      line: 1,
      offset: 0,
      length: 14,
    };
    const pages = await createDetectWork([async () => [figure]])(
      [
        {
          pageId: 'p1',
          lines: ['Lena Brockmann trifft Jonte.', 'Lena und Brockmanns Vater.'],
        },
      ],
      { workName: 'Aufsatz.pdf', language: 'de' },
      signal,
    );
    const before: PrivacyWork = {
      id: 'w2',
      name: 'Aufsatz',
      status: 'open',
      pages,
      removed: [],
      message: null,
    };
    expect(shown(before)).toEqual([
      '<Lena Brockmann=[Person 1]> trifft Jonte.',
      '<Lena=[Person 2]> und <Brockmann=[Person 3]>s Vater.',
    ]);

    const removed = removeIdentifier(before, 'p1', { line: 1, offset: 0, length: 14 });
    expect(shown(removed)).toEqual(['Lena Brockmann trifft Jonte.', 'Lena und Brockmanns Vater.']);

    const again = addIdentifier(removed, 'p1', { line: 1, offset: 0, length: 14 }, 'person');
    expect(again.removed).toEqual([]);
    expect(shown(again)).toEqual(shown(before));
  });

  it('keeps a full name when only one of its parts is taken back', async () => {
    const before = await work();
    const removed = removeIdentifier(before, 'p1', { line: 2, offset: 0, length: 3 });
    expect(shown(removed)[0]).toBe('Ich bin <Mia Schulz=[Person 1]>.');
  });

  it('changes nothing once the work is released', async () => {
    const released: PrivacyWork = { ...(await work()), status: 'released' };
    expect(addIdentifier(released, 'p2', { line: 1, offset: 0, length: 3 }, 'person')).toBe(
      released,
    );
    expect(removeIdentifier(released, 'p1', { line: 1, offset: 8, length: 10 })).toBe(released);
  });

  it('drops pages that are gone', async () => {
    const before = await work();
    expect(dropPages(before, new Set(['p1', 'p2']))).toBe(before);
    expect(dropPages(before, new Set(['p2'])).pages.map((page) => page.pageId)).toEqual(['p2']);
  });
});
