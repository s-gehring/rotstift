import { useEffect, useState } from 'react';

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}

export function useFileDrop(onFiles: (files: File[]) => void): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (hasFiles(event)) setActive(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setActive(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setActive(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setActive(false);
      onFiles(Array.from(event.dataTransfer?.files ?? []));
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [onFiles]);

  return active;
}
