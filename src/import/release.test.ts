import { describe, expect, it, vi } from 'vitest';
import type { ImportPage } from './pages.ts';
import { releaseRemoved } from './release.ts';

function page(id: string, documentId?: string): ImportPage {
  return {
    id,
    fileKey: id,
    label: id,
    source:
      documentId === undefined
        ? { kind: 'image', file: new File([], `${id}.png`) }
        : { kind: 'pdf', documentId, pageNumber: 1 },
    width: 1,
    height: 1,
    rotation: 0,
    thumbnailUrl: `blob:${id}`,
  };
}

function targets() {
  return {
    revokeUrl: vi.fn<(url: string) => void>(),
    releaseDocument: vi.fn<(documentId: string) => void>(),
  };
}

describe('releaseRemoved', () => {
  it('revokes only the thumbnails of removed pages', () => {
    const spies = targets();
    releaseRemoved([page('a'), page('b')], [page('b')], spies);
    expect(spies.revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:a');
    expect(spies.releaseDocument).not.toHaveBeenCalled();
  });

  it('keeps a PDF while any of its pages remains', () => {
    const spies = targets();
    releaseRemoved([page('a', 'doc'), page('b', 'doc')], [page('b', 'doc')], spies);
    expect(spies.releaseDocument).not.toHaveBeenCalled();
  });

  it('releases a PDF once its last page is gone', () => {
    const spies = targets();
    releaseRemoved([page('a', 'doc'), page('b', 'other')], [page('b', 'other')], spies);
    expect(spies.releaseDocument).toHaveBeenCalledExactlyOnceWith('doc');
  });

  it('releases everything when the list is cleared', () => {
    const spies = targets();
    releaseRemoved([page('a', 'doc'), page('b')], [], spies);
    expect(spies.revokeUrl).toHaveBeenCalledTimes(2);
    expect(spies.releaseDocument).toHaveBeenCalledExactlyOnceWith('doc');
  });

  it('does nothing when nothing was removed', () => {
    const spies = targets();
    const pages = [page('a', 'doc')];
    releaseRemoved(pages, pages, spies);
    expect(spies.revokeUrl).not.toHaveBeenCalled();
    expect(spies.releaseDocument).not.toHaveBeenCalled();
  });
});
