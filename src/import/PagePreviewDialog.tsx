import { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog.tsx';
import type { ImportPage } from './pages.ts';
import { renderPageToPng } from './render-page.ts';

const PREVIEW_EDGE = 1600;

export interface PreviewTarget {
  readonly page: ImportPage;
  readonly title: string;
}

type Preview = { readonly url: string } | 'failed' | null;

function PreviewImage({ page, title }: PreviewTarget) {
  const [preview, setPreview] = useState<Preview>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    renderPageToPng(page, { maxEdge: PREVIEW_EDGE }).then(
      (blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPreview({ url });
      },
      () => {
        if (!cancelled) setPreview('failed');
      },
    );
    return () => {
      cancelled = true;
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [page]);

  if (preview === 'failed')
    return <p className="preview-note">Die Seite lässt sich nicht anzeigen.</p>;
  if (preview === null) return <p className="preview-note">Wird geladen …</p>;
  return <img className="preview-image" src={preview.url} alt={title} />;
}

export function PagePreviewDialog({
  target,
  onClose,
}: {
  readonly target: PreviewTarget | null;
  readonly onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onClose={onClose} title={target?.title ?? ''} size="lg">
      {target !== null && <PreviewImage key={target.page.id} {...target} />}
    </Dialog>
  );
}
