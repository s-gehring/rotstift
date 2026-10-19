import { useEffect, useRef, useState } from 'react';
import type { ImportPage } from '../import/pages.ts';
import { describeProgress, formatRemaining } from '../pipeline/progress.ts';
import { startablePages } from '../pipeline/runner.ts';
import type { TranscriberStatus } from '../pipeline/transcriber.ts';
import { buildRows, countedPages, pagesText, totalWords, wordsText } from './summary.ts';
import type { WordCount } from './use-word-count.ts';

interface CountProps {
  readonly count: WordCount;
  readonly status: TranscriberStatus | null;
  readonly pages: readonly ImportPage[];
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function finishedText(pages: readonly ImportPage[], count: WordCount): string {
  const rows = buildRows(pages, count.state.entries);
  const failed = rows.filter((row) => row.status === 'error').length;
  const parts = [
    `Fertig: ${wordsText(totalWords(rows))} auf ${pagesText(countedPages(rows))}.`,
    failed > 0 ? `${pagesText(failed)} nicht erkannt.` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

export function CountControls({ count, status, pages }: CountProps) {
  const { runner, state } = count;
  const running = state.batch !== null;
  const now = useNow(running);
  const progress = describeProgress(state, now);
  const [announcement, setAnnouncement] = useState('');
  const wasRunning = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (wasRunning.current && !running) {
      setAnnouncement(cancelled.current ? 'Abgebrochen.' : finishedText(pages, count));
      cancelled.current = false;
    }
    wasRunning.current = running;
  }, [running, pages, count]);

  const nothingToDo =
    pages.length > 0 &&
    Object.keys(state.entries).length > 0 &&
    startablePages(pages, state).queue.length === 0;
  const disabled = status?.state !== 'ready' || pages.length === 0 || nothingToDo;

  const cancel = () => {
    cancelled.current = true;
    runner.cancel();
  };

  let message = announcement;
  if (progress !== null) {
    const remaining =
      progress.remainingMs === null
        ? 'Restzeit wird geschätzt …'
        : `noch ${formatRemaining(progress.remainingMs)}`;
    message = `Seite ${progress.current} von ${progress.total} · ${remaining}`;
  }

  return (
    <>
      <button
        type="button"
        className="primary"
        disabled={!running && disabled}
        aria-describedby="count-hint"
        onClick={running ? cancel : runner.start}
      >
        {running ? 'Abbrechen' : 'Wörter zählen'}
      </button>
      <p className="progress" role="status">
        {message}
      </p>
    </>
  );
}

export function CountHint({ count, status, pages }: CountProps) {
  const messages: { text: string; demo?: boolean }[] = [];
  if (status === null) {
    messages.push({ text: 'Texterkennung wird geprüft …' });
  } else if (status.state === 'unavailable') {
    messages.push({ text: `Wörter zählen ist gerade nicht möglich. ${status.message}` });
  } else {
    if (status.demo) {
      messages.push({
        text: 'Demo-Modus: Statt einer echten Erkennung liefert die Entwicklungsumgebung Platzhalter („Demo-Text“).',
        demo: true,
      });
    }
    const { queue, skippedEdited } = startablePages(pages, count.state);
    if (queue.length === 0 && Object.keys(count.state.entries).length > 0 && pages.length > 0) {
      const skipped = skippedEdited.map((page) => `Seite ${pages.indexOf(page) + 1}`);
      messages.push({
        text:
          skipped.length === 0
            ? 'Alle Seiten sind gezählt.'
            : `Alle Seiten sind gezählt. ${skipped.join(', ')} wurde nach Ihrer Bearbeitung gedreht und nicht neu erkannt.`,
      });
    }
  }

  return (
    <div id="count-hint">
      {messages.map((message) => (
        <p key={message.text} className={message.demo ? 'notice demo' : 'notice'}>
          {message.text}
        </p>
      ))}
    </div>
  );
}
