import { useEffect, useRef } from 'react';
import { findErrorKind } from '../annotations/catalog.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';
import { splitStruck, strokeStruck, unstrokeStruck } from '../annotations/struck.ts';
import type { HintStatus } from '../correction/uncertain-reading.ts';
import type { CommentStatus } from './review-flow.ts';
import { formatCount, wordsText } from '../results/summary.ts';
import { Button } from '../ui/Button.tsx';
import { classNames } from '../ui/class-names.ts';
import type { ContentReviewModel, HintEntry, MarkEntry, PageModel } from './arbeit-model.ts';
import { errorsText } from './summary.ts';

export interface PageHint {
  readonly pageId: string;
  readonly index: number;
}

export interface PageMark {
  readonly pageId: string;
  readonly key: string;
}

export interface ArbeitSideProps {
  readonly pages: readonly PageModel[];
  readonly content?: ContentReviewModel | null;
  readonly onComment?: (index: number, status: CommentStatus) => void;
  readonly corrected: boolean;
  readonly profile: CorrectionProfile | null;
  readonly editing: string | null;
  readonly editLocked: boolean;
  readonly activeMark: PageMark | null;
  readonly activeHint: PageHint | null;
  readonly selectedHint: (PageHint & { readonly seq: number }) | null;
  readonly openGroups: ReadonlySet<string>;
  readonly onToggleGroup: (pageId: string, open: boolean) => void;
  readonly onMarkHover: (mark: PageMark | null) => void;
  readonly onMarkSelect: (mark: PageMark) => void;
  readonly onHintHover: (hint: PageHint | null) => void;
  readonly onHintReveal: (hint: PageHint) => void;
  readonly onHint: (pageId: string, index: number, status: HintStatus) => void;
  readonly onEdit: (pageId: string, text: string) => void;
  readonly onEditDone: () => void;
}

const ACTIVITY_TEXT = {
  reading: 'wird gelesen …',
  correcting: 'wird korrigiert …',
} as const;

function typeName(profile: CorrectionProfile | null, code: string): string {
  if (profile === null) return code;
  return findErrorKind(profile.language, code)?.name ?? code;
}

function pageFigure(page: PageModel, corrected: boolean): string {
  if (page.activity !== null) return ACTIVITY_TEXT[page.activity];
  if (page.open) return 'offen';
  if (page.problem !== null) return 'nicht gelesen';
  if (page.empty) return 'leer';
  if (corrected) return page.correction === null ? '–' : errorsText(page.correction.errors);
  return page.words === null ? '–' : wordsText(page.words);
}

function MarkList({
  pageId,
  marks,
  profile,
  active,
  onHover,
  onSelect,
}: {
  readonly pageId: string;
  readonly marks: readonly MarkEntry[];
  readonly profile: CorrectionProfile | null;
  readonly active: string | null;
  readonly onHover: (mark: PageMark | null) => void;
  readonly onSelect: (mark: PageMark) => void;
}) {
  if (marks.length === 0) return <p className="side-empty">Keine Fehler</p>;
  return (
    <ul className="side-marks">
      {marks.map((mark) => {
        const name = typeName(profile, mark.type);
        const target = { pageId, key: mark.key };
        return (
          <li key={mark.key}>
            <button
              type="button"
              className={classNames('side-mark', mark.key === active && 'is-active')}
              data-mark-key={mark.key}
              aria-label={`${name}: ${mark.text}`}
              onPointerEnter={() => onHover(target)}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onHover(target)}
              onBlur={() => onHover(null)}
              onClick={() => onSelect(target)}
            >
              <abbr className="side-mark-code" title={name}>
                {mark.type}
              </abbr>
              <span className="side-mark-text">{mark.text}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const HINT_DONE: Readonly<Record<Exclude<HintStatus, 'open'>, string>> = {
  accepted: 'übernommen',
  dismissed: 'verworfen',
};

function hintSummary(hints: readonly HintEntry[]): string {
  const open = hints.filter((hint) => hint.status === 'open').length;
  return open > 0
    ? `${formatCount(open)} unsicher gelesen`
    : `${formatCount(hints.length)} unsicher gelesen, geprüft`;
}

function HintGroup({
  pageId,
  hints,
  open,
  active,
  selected,
  onToggle,
  onHover,
  onReveal,
  onHint,
}: {
  readonly pageId: string;
  readonly hints: readonly HintEntry[];
  readonly open: boolean;
  readonly active: number | null;
  readonly selected: { readonly index: number; readonly seq: number } | null;
  readonly onToggle: (open: boolean) => void;
  readonly onHover: (hint: PageHint | null) => void;
  readonly onReveal: (hint: PageHint) => void;
  readonly onHint: (index: number, status: HintStatus) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (selected === null || !open) return;
    const item = list.current?.querySelector<HTMLElement>(`[data-hint="${selected.index}"]`);
    item?.scrollIntoView({ block: 'nearest' });
    item
      ?.querySelector<HTMLButtonElement>('.side-hint-actions button')
      ?.focus({ preventScroll: true });
  }, [selected, open]);
  if (hints.length === 0) return null;
  return (
    <details
      className="side-hints"
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open !== open) onToggle(event.currentTarget.open);
      }}
    >
      <summary>{hintSummary(hints)}</summary>
      <ul ref={list}>
        {hints.map((hint) => (
          <li
            key={hint.index}
            data-hint={hint.index}
            data-status={hint.status}
            className={classNames('side-hint', hint.index === active && 'is-active')}
            onPointerEnter={() => onHover({ pageId, index: hint.index })}
            onPointerLeave={() => onHover(null)}
          >
            <button
              type="button"
              className="side-hint-text"
              onClick={() => onReveal({ pageId, index: hint.index })}
            >
              {hint.text}
            </button>
            <span className="side-hint-actions">
              {hint.status === 'open' ? (
                <>
                  <Button
                    variant="quiet"
                    aria-label={`Übernehmen: ${hint.text}`}
                    onClick={() => onHint(hint.index, 'accepted')}
                  >
                    Übernehmen
                  </Button>
                  <Button
                    variant="quiet"
                    aria-label={`Verwerfen: ${hint.text}`}
                    onClick={() => onHint(hint.index, 'dismissed')}
                  >
                    Verwerfen
                  </Button>
                </>
              ) : (
                <>
                  <span className="side-hint-state">{HINT_DONE[hint.status]}</span>
                  <Button
                    variant="quiet"
                    aria-label={`Rückgängig: ${hint.text}`}
                    onClick={() => onHint(hint.index, 'open')}
                  >
                    Rückgängig
                  </Button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

const CONTENT_STATUS = {
  reviewing: 'wird geprüft …',
  cancelled: 'abgebrochen',
} as const;

function ContentSection({
  content,
  onComment,
}: {
  readonly content: ContentReviewModel;
  readonly onComment: (index: number, status: CommentStatus) => void;
}) {
  const open = content.comments.filter((comment) => comment.status === 'open');
  if (content.status === 'done' && content.comments.length === 0) {
    return <p className="side-empty">Inhalt und Form: keine Auffälligkeiten</p>;
  }
  const figure =
    content.status === 'reviewing' || content.status === 'cancelled'
      ? CONTENT_STATUS[content.status]
      : content.status === 'failed'
        ? 'nicht geprüft'
        : formatCount(open.length);
  return (
    <section className="side-page side-content" aria-labelledby="side-content">
      <header className="side-page-head">
        <h2 id="side-content">Inhalt und Form</h2>
        <span className="side-page-figure">{figure}</span>
      </header>
      {content.status === 'failed' && content.message !== null && (
        <p className="side-empty">{content.message}</p>
      )}
      {content.comments.length > 0 && (
        <ul className="side-comments">
          {content.comments.map((comment) => (
            <li key={comment.index} className="side-hint" data-status={comment.status}>
              <span className="side-comment-text">
                <span className="side-comment-place">
                  S. {comment.page}, Z. {comment.line}
                </span>{' '}
                {comment.text}
                {comment.coveredBy !== null && (
                  <span className="side-comment-place"> · siehe {comment.coveredBy}</span>
                )}
              </span>
              <span className="side-hint-actions">
                {comment.status === 'open' ? (
                  <Button
                    variant="quiet"
                    aria-label={`Verwerfen: ${comment.text}`}
                    onClick={() => onComment(comment.index, 'dismissed')}
                  >
                    Verwerfen
                  </Button>
                ) : (
                  <>
                    <span className="side-hint-state">verworfen</span>
                    <Button
                      variant="quiet"
                      aria-label={`Rückgängig: ${comment.text}`}
                      onClick={() => onComment(comment.index, 'open')}
                    >
                      Rückgängig
                    </Button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {content.summary !== null && <p className="side-summary">{content.summary}</p>}
    </section>
  );
}

function TextEditor({
  page,
  locked,
  onEdit,
  onDone,
}: {
  readonly page: PageModel;
  readonly locked: boolean;
  readonly onEdit: (text: string) => void;
  readonly onDone: () => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus({ preventScroll: true }), []);
  const text = strokeStruck(page.text ?? '');
  return (
    <div className="side-editor">
      <textarea
        ref={area}
        aria-label={`Text von Seite ${page.position}`}
        value={text}
        readOnly={locked || !page.editable}
        rows={Math.min(Math.max(text.split('\n').length + 1, 6), 24)}
        spellCheck={false}
        onChange={(event) => onEdit(unstrokeStruck(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onDone();
          }
        }}
      />
      <div className="side-editor-foot">
        <span className="side-words">{page.words === null ? '' : wordsText(page.words)}</span>
        <Button onClick={onDone}>Fertig</Button>
      </div>
    </div>
  );
}

export function ArbeitSide({
  pages,
  content = null,
  onComment,
  corrected,
  profile,
  editing,
  editLocked,
  activeMark,
  activeHint,
  selectedHint,
  openGroups,
  onToggleGroup,
  onMarkHover,
  onMarkSelect,
  onHintHover,
  onHintReveal,
  onHint,
  onEdit,
  onEditDone,
}: ArbeitSideProps) {
  return (
    <aside className="detail-side" aria-label={corrected ? 'Fehler' : 'Text'}>
      {pages.map((page) => {
        const id = page.page.id;
        const headingId = `side-${id}`;
        let body: React.ReactNode = null;
        if (editing === id) {
          body = (
            <TextEditor
              page={page}
              locked={editLocked}
              onEdit={(text) => onEdit(id, text)}
              onDone={onEditDone}
            />
          );
        } else if (corrected && page.correction !== null && !page.open) {
          body = (
            <>
              <MarkList
                pageId={id}
                marks={page.correction.marks}
                profile={profile}
                active={activeMark?.pageId === id ? activeMark.key : null}
                onHover={onMarkHover}
                onSelect={onMarkSelect}
              />
              <HintGroup
                pageId={id}
                hints={page.correction.hints}
                open={openGroups.has(id)}
                active={activeHint?.pageId === id ? activeHint.index : null}
                selected={selectedHint?.pageId === id ? selectedHint : null}
                onToggle={(open) => onToggleGroup(id, open)}
                onHover={onHintHover}
                onReveal={onHintReveal}
                onHint={(index, status) => onHint(id, index, status)}
              />
            </>
          );
        } else if (!corrected && page.text !== null && page.text.trim() !== '') {
          body = (
            <p className="side-text">
              {splitStruck(page.text).map((part, index) =>
                part.struck ? <s key={index}>{part.text}</s> : part.text,
              )}
            </p>
          );
        }
        return (
          <section key={id} className="side-page" aria-labelledby={headingId}>
            <header className="side-page-head">
              <h2 id={headingId}>Seite {page.position}</h2>
              <span className="side-page-figure">
                {editing === id ? (page.edited ? 'bearbeitet' : '') : pageFigure(page, corrected)}
              </span>
            </header>
            {body}
          </section>
        );
      })}
      {corrected && content !== null && onComment !== undefined && (
        <ContentSection content={content} onComment={onComment} />
      )}
    </aside>
  );
}
