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

  it('groups the strokes of each mark and reports hovering and clicking it', () => {
    const hovered: (string | null)[] = [];
    const selected: string[] = [];
    render(
      <AnnotatedPage
        imageUrl="blob:p"
        size={FIXTURE_PAGE}
        transcript={transcript}
        profile={DEUTSCH}
        activeMark="1:1"
        onMarkHover={(key) => hovered.push(key)}
        onMarkSelect={(key) => selected.push(key)}
      />,
    );
    const group = container.querySelector('[data-mark-key="1:1"]');
    expect(group?.querySelector('path[data-role]')?.getAttribute('data-mark')).toBe('1');
    expect(group?.querySelector('.annotated-page__hit')).not.toBeNull();
    expect(group?.classList.contains('is-active')).toBe(true);
    expect(container.firstElementChild?.getAttribute('data-active')).toBe('1:1');
    act(() => {
      group?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
      group?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      group?.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
    });
    expect(hovered).toEqual(['1:1', null]);
    expect(selected).toEqual(['1:1']);
  });

  it('dots only the open uncertain readings and reports a click on them', () => {
    const selected: number[] = [];
    const mark = {
      kind: 'error',
      type: 'R',
      original: 'Schwimbad',
      correction: 'Schwimmbad',
    } as const;
    const offset = transcript.lines[0]?.text.indexOf('Schwimbad') ?? 0;
    render(
      <AnnotatedPage
        imageUrl="blob:p"
        size={FIXTURE_PAGE}
        transcript={transcript}
        profile={DEUTSCH}
        hints={[
          { line: 1, mark: { ...mark, offset }, confidence: 0.3, status: 'open' },
          { line: 1, mark: { ...mark, offset }, confidence: 0.3, status: 'accepted' },
        ]}
        onHintSelect={(index) => selected.push(index)}
      />,
    );
    const spots = container.querySelectorAll('.hint-spot');
    expect(spots).toHaveLength(1);
    expect(spots[0]?.getAttribute('aria-label')).toBe(
      'Unsicher gelesen: „Schwimbad“ → „Schwimmbad“',
    );
    act(() => {
      spots[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      spots[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(selected).toEqual([0, 0]);
  });
});
