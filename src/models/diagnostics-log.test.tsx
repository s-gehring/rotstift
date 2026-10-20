// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticsLog, type DiagnosticsSource } from './DiagnosticsLog.tsx';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLElement;
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

function source(lines: string[]): DiagnosticsSource & {
  read: ReturnType<typeof vi.fn<DiagnosticsSource['read']>>;
  copy: ReturnType<typeof vi.fn<DiagnosticsSource['copy']>>;
  clear: ReturnType<typeof vi.fn<DiagnosticsSource['clear']>>;
} {
  return {
    read: vi.fn<DiagnosticsSource['read']>(() => Promise.resolve(lines)),
    copy: vi.fn<DiagnosticsSource['copy']>(() => Promise.resolve()),
    clear: vi.fn<DiagnosticsSource['clear']>(() => Promise.resolve()),
  };
}

const button = (label: string) =>
  [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === label);

async function openLog() {
  const details = container.querySelector('details');
  if (details === null) throw new Error('missing details');
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await Promise.resolve();
  });
}

describe('DiagnosticsLog', () => {
  it('stays collapsed as "Protokoll" and reads nothing until opened', () => {
    const fake = source([]);
    act(() => root.render(<DiagnosticsLog source={fake} />));
    expect(container.querySelector('summary')?.textContent).toBe('Protokoll');
    expect(fake.read).not.toHaveBeenCalled();
  });

  it('shows the entries and copies them for an email', async () => {
    const lines = [
      '{"event":"page_done","totalMs":1200}',
      '{"event":"heartbeat_gap","gapMs":45000}',
    ];
    const fake = source(lines);
    act(() => root.render(<DiagnosticsLog source={fake} />));
    await openLog();
    expect(container.querySelector('.diagnostics-entries')?.textContent).toBe(lines.join('\n'));

    await act(async () => {
      button('Kopieren')?.click();
      await Promise.resolve();
    });
    expect(fake.copy).toHaveBeenCalledWith(lines.join('\n'));
    expect(container.textContent).toContain('Zwischenablage');
  });

  it('says so when the log is empty and keeps the copy button disabled', async () => {
    act(() => root.render(<DiagnosticsLog source={source([])} />));
    await openLog();
    expect(container.textContent).toContain('Noch keine Einträge');
    expect(button('Kopieren')?.disabled).toBe(true);
  });

  it('reports a failed read and a failed copy in German', async () => {
    const fake = source(['{"event":"x"}']);
    fake.read.mockRejectedValueOnce(new Error('boom'));
    fake.copy.mockRejectedValueOnce(new Error('denied'));
    act(() => root.render(<DiagnosticsLog source={fake} />));
    await openLog();
    expect(container.textContent).toContain('konnte nicht gelesen werden');

    await act(async () => {
      button('Aktualisieren')?.click();
      await Promise.resolve();
    });
    await act(async () => {
      button('Kopieren')?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Kopieren war nicht möglich');
  });

  it('deletes the log only after a confirmation', async () => {
    const fake = source(['{"event":"x"}']);
    act(() => root.render(<DiagnosticsLog source={fake} />));
    await openLog();

    await act(async () => {
      button('Protokoll löschen')?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('wirklich löschen');
    expect(fake.clear).not.toHaveBeenCalled();

    await act(async () => {
      button('Behalten')?.click();
      await Promise.resolve();
    });
    expect(fake.clear).not.toHaveBeenCalled();

    await act(async () => {
      button('Protokoll löschen')?.click();
      await Promise.resolve();
    });
    fake.read.mockResolvedValueOnce([]);
    await act(async () => {
      button('Endgültig löschen')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fake.clear).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Noch keine Einträge');
  });
});
