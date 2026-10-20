// @vitest-environment happy-dom
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { sharedUrlCount, useObjectUrl } from './page-image.ts';
import { tick } from './test-support.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function Picture({ blob }: { readonly blob: Blob }) {
  const url = useObjectUrl(blob);
  return url === null ? null : <img src={url} alt="" />;
}

describe('useObjectUrl', () => {
  it('shares one URL per image and frees it after the last user is gone', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    act(() =>
      root.render(
        <StrictMode>
          <Picture blob={blob} />
          <Picture blob={blob} />
        </StrictMode>,
      ),
    );
    await act(tick);
    const sources = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(sources[0]).toMatch(/^blob:/);
    expect(sources[1]).toBe(sources[0]);
    expect(sharedUrlCount()).toBe(1);

    act(() => root.unmount());
    await tick();
    expect(sharedUrlCount()).toBe(0);
  });
});
