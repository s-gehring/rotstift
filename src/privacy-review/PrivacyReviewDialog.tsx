import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useApp } from '../app/app-context.tsx';
import { PLACEHOLDER_LABELS, type IdentifierCategory } from '../privacy/types.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { findText, selectedRange, type ChosenRange } from './selection.ts';
import {
  reviewText,
  SENSITIVE_LABELS,
  type PrivacyWork,
  type PrivacyWorkStatus,
  type Segment,
} from './review-work.ts';

export const PRIVACY_REVIEW_TITLE = 'Vor dem Senden prüfen';

export const SENT_NOTE =
  'Gesendet wird nur der Text mit Platzhaltern, also pseudonymisiert, und erst nach der Freigabe.';

export const NOT_FOUND = 'Diese Stelle steht nicht im Text.';

const STATUS_TEXT: Readonly<Record<PrivacyWorkStatus, string>> = {
  detecting: 'wird erkannt',
  open: 'zu prüfen',
  released: 'freigegeben',
  failed: 'nicht erkannt',
};

const CATEGORIES: readonly IdentifierCategory[] = [
  'person',
  'place',
  'institution',
  'contact',
  'date',
  'number',
];

function workName(work: PrivacyWork): string {
  return work.name.trim() === '' ? 'Arbeit' : work.name;
}

function SegmentView({
  segment,
  editable,
  onRemove,
}: {
  readonly segment: Segment;
  readonly editable: boolean;
  readonly onRemove: () => void;
}) {
  if (segment.kind === 'plain') return segment.text;
  if (segment.kind === 'sensitive') {
    const label = SENSITIVE_LABELS[segment.category];
    return (
      <mark className="privacy-sensitive" title={`Sensible Angabe: ${label}, wird nicht ersetzt`}>
        {segment.text}
        <span className="privacy-sensitive-label" data-skip="">
          {` Warnung: ${label}`}
        </span>
      </mark>
    );
  }
  return (
    <mark className="privacy-identifier" data-category={segment.category}>
      {segment.text}
      <span className="privacy-placeholder" data-skip="">
        {` ${segment.placeholder}`}
        {editable && (
          <IconButton
            label={`„${segment.text}“ nicht ersetzen`}
            icon="close"
            tooltip="none"
            className="privacy-remove"
            onClick={onRemove}
          />
        )}
      </span>
    </mark>
  );
}

function AddForm({
  work,
  chosen,
}: {
  readonly work: PrivacyWork;
  readonly chosen: ChosenRange | null;
}) {
  const { privacy } = useApp();
  const [text, setText] = useState('');
  const [category, setCategory] = useState<IdentifierCategory>('person');
  const [problem, setProblem] = useState<string | null>(null);
  const [lastChosen, setLastChosen] = useState<ChosenRange | null>(null);
  const textId = useId();
  const categoryId = useId();
  if (chosen !== lastChosen) {
    setLastChosen(chosen);
    if (chosen !== null) {
      setText(chosen.text);
      setProblem(null);
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const wanted = text.trim();
    if (wanted === '') return;
    const found =
      chosen !== null && chosen.text.trim() === wanted ? chosen : findText(work.pages, wanted);
    if (found === null) {
      setProblem(NOT_FOUND);
      return;
    }
    privacy.add(work.id, found.pageId, found.range, category);
    setText('');
    setProblem(null);
  };
  return (
    <form className="privacy-add" onSubmit={submit} aria-label="Stelle ergänzen">
      <label htmlFor={textId}>Stelle</label>
      <input
        id={textId}
        type="text"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setProblem(null);
        }}
      />
      <label htmlFor={categoryId}>Art</label>
      <select
        id={categoryId}
        value={category}
        onChange={(event) => {
          const next = CATEGORIES.find((entry) => entry === event.target.value);
          if (next !== undefined) setCategory(next);
        }}
      >
        {CATEGORIES.map((value) => (
          <option key={value} value={value}>
            {PLACEHOLDER_LABELS[value]}
          </option>
        ))}
      </select>
      <Button type="submit" disabled={text.trim() === ''}>
        Ergänzen
      </Button>
      {problem !== null && (
        <p className="privacy-problem" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

function WorkText({ work }: { readonly work: PrivacyWork }) {
  const { privacy, importState } = useApp();
  const pages = useMemo(() => reviewText(work), [work]);
  const [chosen, setChosen] = useState<ChosenRange | null>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const editable = work.status === 'open';
  const arbeit = importState.arbeiten.find((entry) => entry.id === work.id);
  const pageNumber = (pageId: string) => {
    const index = arbeit?.pages.findIndex((page) => page.id === pageId) ?? -1;
    return index < 0 ? null : index + 1;
  };
  const identifiers = pages.flatMap((page) =>
    page.lines.flatMap((line) => line.segments.filter((segment) => segment.kind === 'identifier')),
  ).length;
  const warnings = pages.flatMap((page) =>
    page.lines.flatMap((line) => line.segments.filter((segment) => segment.kind === 'sensitive')),
  ).length;
  const pick = () => {
    const container = linesRef.current;
    if (container === null || !editable) return;
    const found = selectedRange(container, globalThis.getSelection());
    if (found !== null) setChosen(found);
  };
  return (
    <section className="privacy-work" aria-label={workName(work)}>
      <h3 className="privacy-work-title">{workName(work)}</h3>
      {work.status === 'detecting' && <p className="privacy-quiet">Wird erkannt …</p>}
      {work.status === 'failed' && (
        <p className="privacy-problem" role="alert">
          {work.message}
        </p>
      )}
      {work.status !== 'detecting' && work.status !== 'failed' && (
        <>
          <p className="privacy-counts">
            {`${identifiers} ${identifiers === 1 ? 'Stelle' : 'Stellen'} ersetzt`}
            {warnings > 0 && ` · ${warnings} ${warnings === 1 ? 'Warnung' : 'Warnungen'}`}
          </p>
          {editable && <AddForm work={work} chosen={chosen} />}
          <div className="privacy-text" ref={linesRef} onMouseUp={pick} onKeyUp={pick}>
            {pages.map((page, pageIndex) => {
              const number = pageNumber(page.pageId) ?? pageIndex + 1;
              return (
                <div key={page.pageId} className="privacy-page" data-page-id={page.pageId}>
                  <h4>{`Seite ${number}`}</h4>
                  {page.lines.map((line) => (
                    <p key={line.line} className="privacy-line" data-line={line.line}>
                      {line.segments.map((segment, index) => (
                        <SegmentView
                          key={index}
                          segment={segment}
                          editable={editable}
                          onRemove={() => {
                            if (segment.kind === 'identifier') {
                              privacy.remove(work.id, page.pageId, segment.range);
                            }
                          }}
                        />
                      ))}
                    </p>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export function PrivacyReviewDialog() {
  const { privacy } = useApp();
  const works = useMemo(() => privacy.works ?? [], [privacy.works]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    works.find((work) => work.id === selectedId) ??
    works.find((work) => work.status === 'open' || work.status === 'detecting') ??
    works[0];
  const release = () => {
    if (selected === undefined) return;
    privacy.release(selected.id);
    const next = works.find((work) => work.id !== selected.id && work.status === 'open');
    if (next !== undefined) setSelectedId(next.id);
    else if (!works.some((work) => work.id !== selected.id && work.status === 'detecting')) {
      privacy.close();
    }
  };
  return (
    <Dialog
      open={privacy.open}
      onClose={privacy.close}
      title={PRIVACY_REVIEW_TITLE}
      size="lg"
      className="privacy-review"
      actions={
        selected !== undefined && (
          <Button variant="primary" disabled={selected.status !== 'open'} onClick={release}>
            Freigeben
          </Button>
        )
      }
    >
      <p className="privacy-note">{SENT_NOTE}</p>
      <div className="privacy-layout">
        <ul className="privacy-works" aria-label="Arbeiten">
          {works.map((work) => (
            <li key={work.id}>
              <button
                type="button"
                className="privacy-work-item"
                aria-current={work.id === selected?.id ? 'true' : undefined}
                onClick={() => setSelectedId(work.id)}
              >
                <span className="privacy-work-name">{workName(work)}</span>
                <span className="privacy-state" data-status={work.status}>
                  {STATUS_TEXT[work.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {selected !== undefined && <WorkText key={selected.id} work={selected} />}
      </div>
    </Dialog>
  );
}
