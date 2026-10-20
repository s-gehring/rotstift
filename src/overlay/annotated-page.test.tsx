// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { AnnotatedPage } from './AnnotatedPage.tsx';
import { FIXTURE_PAGE, roomyPage } from './fixtures.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: React.ReactElement) {
  act(() => root.render(element));
}

describe('AnnotatedPage', () => {
  const transcript = roomyPage();

  it('shows the page image with an SVG layer in page coordinates on top', () => {
    render(
      <AnnotatedPage
        imageUrl="blob:page-1"
        size={FIXTURE_PAGE}
        transcript={transcript}
        profile={DEUTSCH}
        alt="Seite 1"
      />,
    );
    const image = container.querySelector('img');
    const svg = container.querySelector('svg');
    expect(image?.getAttribute('src')).toBe('blob:page-1');
    expect(image?.getAttribute('alt')).toBe('Seite 1');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 1240 1754');
    expect(image?.nextElementSibling).toBe(svg);
  });

  it('draws one path per mark and the fixes and codes as text', () => {
    render(
      <AnnotatedPage
        imageUrl="blob:p"
        size={FIXTURE_PAGE}
        transcript={transcript}
        profile={DEUTSCH}
      />,
    );
    const marks = transcript.lines.reduce((sum, line) => sum + line.marks.length, 0);
    expect(container.querySelectorAll('path[data-role]').length).toBe(marks);
    const fixes = [...container.querySelectorAll('text[data-role="fix"]')].map(
      (node) => node.childNodes[0]?.textContent,
    );
    expect(fixes).toContain('Schwimmbad');
    expect(fixes).toContain('war ich');
    const codes = [...container.querySelectorAll('text[data-role="code"]')].map(
      (node) => node.childNodes[0]?.textContent,
    );
    expect(codes[0]).toBe('Sb  R');
  });

  it('describes each mark with the error name for hovering', () => {
    render(
      <AnnotatedPage
        imageUrl="blob:p"
        size={FIXTURE_PAGE}
        transcript={transcript}
        profile={DEUTSCH}
      />,
    );
    const titles = [...container.querySelectorAll('title')].map((node) => node.textContent);
    expect(titles).toContain('R (Rechtschreibung): Schwimbad → Schwimmbad');
  });

  it('updates the layer when the transcript changes', () => {
    render(
      <AnnotatedPage
        imageUrl="blob:p"
        size={FIXTURE_PAGE}
        transcript={transcript}
        profile={DEUTSCH}
      />,
    );
    const before = container.querySelectorAll('path[data-role]').length;
    render(
      <AnnotatedPage
        imageUrl="blob:p"
        size={FIXTURE_PAGE}
        transcript={{ lines: transcript.lines.slice(0, 1) }}
        profile={DEUTSCH}
      />,
    );
    expect(container.querySelectorAll('path[data-role]').length).toBeLessThan(before);
  });

  it('lets the pointer through to the page below', () => {
    render(
      <AnnotatedPage
        imageUrl="blob:p"
        size={FIXTURE_PAGE}
        transcript={transcript}
        profile={DEUTSCH}
        className="extra"
      />,
    );
    expect(container.firstElementChild?.className).toBe('annotated-page extra');
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('annotated-page__overlay');
  });

  it('reports lines it could not place', () => {
    render(
      <AnnotatedPage
        imageUrl="blob:p"
        size={FIXTURE_PAGE}
        transcript={{
          lines: [
            {
              number: 3,
              text: 'Wlt',
              marks: [{ kind: 'error', type: 'R', original: 'Wlt', correction: 'Welt', offset: 0 }],
            },
          ],
        }}
        profile={DEUTSCH}
      />,
    );
    expect(container.querySelector('svg')?.getAttribute('data-skipped-lines')).toBe('3');
  });
});
