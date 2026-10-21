import { useEffect, useId, useState } from 'react';
import { useApp } from '../app/app-context.tsx';
import { ExportMenu } from '../export/ExportMenu.tsx';
import { hasResults } from '../export/has-results.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import { wordsText } from '../results/summary.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import type { MenuEntry } from '../ui/Menu.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { buildArbeitModel, type ArbeitFigures, type PageModel } from './arbeit-model.ts';
import { ArbeitPage } from './ArbeitPage.tsx';
import { ArbeitSide, type PageHint, type PageMark } from './ArbeitSide.tsx';
import { setDisplay, useDisplay, type Display } from './display.ts';
import { errorsText } from './summary.ts';
import './review.css';

const DISPLAY_OPTIONS = [
  { value: 'corrected', label: 'Korrigiert' },
  { value: 'original', label: 'Original' },
] as const satisfies readonly { value: Display; label: string }[];

const AFTER_RUN = 'Erst nach dem Lauf möglich';
const NO_MODEL = 'Die Modelle sind noch nicht bereit';
const NO_TEXT = 'Noch kein Text erkannt';

function ignoresShortcuts(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true;
  return target.closest('[role="menu"]') !== null;
}

function figuresText({ words, errors, partial }: ArbeitFigures): string {
  const prefix = partial ? 'mind. ' : '';
  const parts: string[] = [];
  if (words !== null) parts.push(prefix + wordsText(words));
  if (errors !== null) parts.push(prefix + errorsText(errors));
  return parts.join(' · ');
}

function scrollToMark(mark: PageMark) {
  const sheet = document.querySelector(`[data-page="${CSS.escape(mark.pageId)}"]`);
  const target = sheet?.querySelector(`[data-mark-key="${CSS.escape(mark.key)}"]`) ?? sheet;
  target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

interface Confirm {
  readonly page: ImportPage;
  readonly position: number;
}

function ArbeitBody({ arbeit }: { readonly arbeit: Arbeit }) {
  const { work, run } = useApp();
  const display = useDisplay();
  const review = work.review.state;
  const entries = work.count.state.entries;
  const model = buildArbeitModel(arbeit, review, entries);
  const { corrected } = model;
  const profile = review.profile;

  const [activeMark, setActiveMark] = useState<PageMark | null>(null);
  const [activeHint, setActiveHint] = useState<PageHint | null>(null);
  const [selectedHint, setSelectedHint] = useState<(PageHint & { seq: number }) | null>(null);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  useEffect(() => {
    if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0 });
  }, []);

  const canRetry = corrected ? work.canRetryReview : work.canRetryCount;
  const retryHint = run.running ? AFTER_RUN : canRetry ? null : NO_MODEL;

  const recognize = (page: ImportPage) => {
    if (corrected) void work.review.flow.retry(page, { recognize: true });
    else work.count.runner.retry(page.id);
  };
  const retry = (page: ImportPage) => {
    if (corrected) void work.review.flow.retry(page);
    else work.count.runner.retry(page.id);
  };

  const menuFor = (page: PageModel): MenuEntry[] => {
    const items: MenuEntry[] = [
      {
        label: 'Text bearbeiten',
        icon: 'pencil',
        onSelect: () => setEditing(page.page.id),
        ...((run.running || !page.editable) && {
          disabled: true,
          hint: run.running ? AFTER_RUN : NO_TEXT,
        }),
      },
      {
        label: 'Neu erkennen',
        icon: 'rotate-right',
        onSelect: () => {
          if (page.edited) setConfirm({ page: page.page, position: page.position });
          else recognize(page.page);
        },
        ...(retryHint !== null && { disabled: true, hint: retryHint }),
      },
    ];
    if (corrected) {
      items.push({
        label: 'Erneut korrigieren',
        onSelect: () => retry(page.page),
        ...((retryHint ?? (page.text === null ? NO_TEXT : null)) !== null && {
          disabled: true,
          hint: retryHint ?? NO_TEXT,
        }),
      });
    }
    return items;
  };

  const selectHint = (pageId: string, index: number) => {
    setOpenGroups((current) => new Set(current).add(pageId));
    setSelectedHint((current) => ({ pageId, index, seq: (current?.seq ?? 0) + 1 }));
  };

  return (
    <div className="detail-body">
      <ol className="detail-pages">
        {model.pages.map((page) => {
          const id = page.page.id;
          return (
            <ArbeitPage
              key={id}
              model={page}
              arbeitName={arbeit.name}
              profile={profile}
              display={display}
              menu={menuFor(page)}
              retry={{ hint: retryHint, onRetry: () => retry(page.page) }}
              activeMark={activeMark?.pageId === id ? activeMark.key : null}
              activeHint={activeHint?.pageId === id ? activeHint.index : null}
              onMarkHover={(key) => setActiveMark(key === null ? null : { pageId: id, key })}
              onMarkSelect={(key) => {
                document
                  .querySelector(`.detail-side [data-mark-key="${CSS.escape(key)}"]`)
                  ?.scrollIntoView({ block: 'nearest' });
              }}
              onHintHover={(index) => setActiveHint(index === null ? null : { pageId: id, index })}
              onHintSelect={(index) => selectHint(id, index)}
            />
          );
        })}
      </ol>
      <ArbeitSide
        pages={model.pages}
        corrected={corrected}
        profile={profile}
        editing={editing}
        editLocked={run.running}
        activeMark={activeMark}
        activeHint={activeHint}
        selectedHint={selectedHint}
        openGroups={openGroups}
        onToggleGroup={(pageId, open) =>
          setOpenGroups((current) => {
            const next = new Set(current);
            if (open) next.add(pageId);
            else next.delete(pageId);
            return next;
          })
        }
        onMarkHover={setActiveMark}
        onMarkSelect={scrollToMark}
        onHintHover={setActiveHint}
        onHint={(pageId, index, status) => work.review.flow.setHint(pageId, index, status)}
        onEdit={(pageId, text) => work.count.runner.edit(pageId, text)}
        onEditDone={() => setEditing(null)}
      />
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title="Neu erkennen?"
        size="sm"
        actions={
          <>
            <Button onClick={() => setConfirm(null)}>Abbrechen</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (confirm !== null) recognize(confirm.page);
                setConfirm(null);
              }}
            >
              Neu erkennen
            </Button>
          </>
        }
      >
        {confirm !== null && (
          <p>Die Änderungen am Text von Seite {confirm.position} gehen verloren.</p>
        )}
      </Dialog>
    </div>
  );
}

export function ArbeitView({ arbeitId }: { readonly arbeitId: string }) {
  const { importState, navigation, work, run } = useApp();
  const { back, next, prev, position } = navigation;
  const display = useDisplay();
  const headingId = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (ignoresShortcuts(event.target)) return;
      if (document.querySelector('dialog[open]') !== null) return;
      if (event.key === 'ArrowLeft') prev();
      else if (event.key === 'ArrowRight') next();
      else if (event.key === 'Escape') back();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [back, next, prev]);

  const arbeit = importState.arbeiten.find((candidate) => candidate.id === arbeitId);
  if (arbeit === undefined) return null;
  const model = buildArbeitModel(arbeit, work.review.state, work.count.state.entries);
  const figures = figuresText(model.figures);
  const headerExports =
    !run.running &&
    (run.done[run.kind] || hasResults(importState.arbeiten, work.count.state.entries));

  return (
    <section className="detail" aria-labelledby={headingId}>
      <div className="detail-head">
        <Button variant="quiet" icon="chevron-left" className="detail-back" onClick={back}>
          Klasse
        </Button>
        <h1 id={headingId} className="detail-name" title={arbeit.name}>
          {arbeit.name}
        </h1>
        {position !== null && (
          <span className="detail-position">
            <IconButton
              label="Vorherige Arbeit"
              icon="chevron-left"
              disabled={position.index === 0}
              onClick={prev}
            />
            <span>
              {position.index + 1} von {position.total}
            </span>
            <IconButton
              label="Nächste Arbeit"
              icon="chevron-right"
              disabled={position.index === position.total - 1}
              onClick={next}
            />
          </span>
        )}
        <span className="detail-spacer" />
        {figures !== '' && <span className="detail-figures">{figures}</span>}
        {model.corrected && (
          <Segmented
            label="Darstellung"
            options={DISPLAY_OPTIONS}
            value={display}
            onChange={setDisplay}
          />
        )}
        {!headerExports && <ExportMenu arbeitId={arbeit.id} variant="secondary" />}
      </div>
      <ArbeitBody key={arbeit.id} arbeit={arbeit} />
    </section>
  );
}
