import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { FORM_SUGGESTIONS } from '../content-form/catalog.ts';
import { MAX_FORM_NAME_LENGTH, needsAssignment, needsFormName } from '../content-form/review.ts';
import { cleanAssignment, MAX_ASSIGNMENT_LENGTH, toggleKind } from '../correction/scope.ts';
import type { ScopeKind } from '../correction/scope.ts';
import { Button } from '../ui/Button.tsx';
import { Icon } from '../ui/icons.tsx';
import { useApp } from './app-context.tsx';
import type { ScopeField } from './types.ts';

const KINDS: readonly { readonly kind: ScopeKind; readonly label: string }[] = [
  { kind: 'spelling', label: 'Rechtschreibung' },
  { kind: 'grammar', label: 'Grammatik' },
  { kind: 'content', label: 'Inhalt' },
  { kind: 'form', label: 'Form' },
];

const FOCUS_ON: Partial<Record<ScopeKind, ScopeField>> = {
  content: 'assignment',
  form: 'formName',
};

export function SubjectSelect() {
  const { subject, run } = useApp();
  const { scope, setScope } = subject;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLSelectElement>(null);
  const assignment = useRef<HTMLTextAreaElement>(null);
  const formName = useRef<HTMLInputElement>(null);
  const [focusField, setFocusField] = useState<ScopeField | null>(null);
  const id = useId();
  const withAssignment = cleanAssignment(scope.assignment) !== '';
  const isOpen = open && !run.running;
  const { missing, clearMissing } = subject;
  const assignmentMissing = missing !== null && needsAssignment(scope);
  const formNameMissing = missing !== null && needsFormName(scope);
  const [shownMissing, setShownMissing] = useState(missing);
  if (shownMissing !== missing) {
    setShownMissing(missing);
    if (missing !== null) {
      setOpen(true);
      setFocusField(missing);
    }
  }

  useEffect(() => {
    if (!isOpen) return undefined;
    first.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || anchor.current?.contains(event.target) !== true) {
        setOpen(false);
        setFocusField(null);
        clearMissing();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen, clearMissing]);

  useEffect(() => {
    if (!isOpen || focusField === null) return;
    (focusField === 'assignment' ? assignment : formName).current?.focus();
  }, [isOpen, focusField]);

  const hide = () => {
    setOpen(false);
    setFocusField(null);
    clearMissing();
  };

  const close = () => {
    hide();
    trigger.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  return (
    <div
      ref={anchor}
      className="menu-anchor subject-select"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next)) hide();
      }}
    >
      <Button
        ref={trigger}
        trailingIcon="chevron-down"
        disabled={run.running}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? id : undefined}
        title={withAssignment ? 'Mit Aufgabenstellung' : undefined}
        onClick={() => (isOpen ? hide() : setOpen(true))}
      >
        {withAssignment && <Icon name="file" className="subject-select-mark" />}
        {subject.profile.subject}
        {withAssignment && <span className="visually-hidden">, mit Aufgabenstellung</span>}
      </Button>
      {isOpen && (
        <div
          id={id}
          role="dialog"
          aria-label="Korrektur"
          tabIndex={-1}
          className="scope-popover"
          onKeyDown={onKeyDown}
        >
          <label className="scope-field">
            <span>Fach</span>
            <select
              ref={first}
              value={subject.profile.id}
              onChange={(event) => {
                const next = subject.profiles.find((profile) => profile.id === event.target.value);
                if (next !== undefined) subject.select(next);
              }}
            >
              {subject.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.subject}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="scope-kinds">
            <legend className="visually-hidden">Korrigieren</legend>
            {KINDS.map(({ kind, label }) => (
              <label key={kind} className="scope-kind">
                <input
                  type="checkbox"
                  checked={scope[kind]}
                  disabled={scope[kind] && toggleKind(scope, kind) === scope}
                  onChange={() => {
                    const next = toggleKind(scope, kind);
                    setScope(next);
                    const field = FOCUS_ON[kind];
                    if (next[kind] && field !== undefined) setFocusField(field);
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
          {scope.form && (
            <label className="scope-field">
              <span>Textform</span>
              <input
                ref={formName}
                type="text"
                list={`${id}-forms`}
                maxLength={MAX_FORM_NAME_LENGTH}
                placeholder="z. B. Persönlicher Brief"
                value={scope.formName}
                aria-invalid={formNameMissing || undefined}
                aria-describedby={formNameMissing ? `${id}-form-error` : undefined}
                onChange={(event) => setScope({ ...scope, formName: event.target.value })}
              />
              <datalist id={`${id}-forms`}>
                {FORM_SUGGESTIONS.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              {formNameMissing && (
                <span id={`${id}-form-error`} className="error-text">
                  Textform fehlt
                </span>
              )}
            </label>
          )}
          <label className="scope-field">
            <span>Aufgabenstellung</span>
            <textarea
              ref={assignment}
              rows={4}
              maxLength={MAX_ASSIGNMENT_LENGTH}
              placeholder="z. B. Schreibe einen Brief an deine Großeltern."
              value={scope.assignment}
              aria-invalid={assignmentMissing || undefined}
              aria-describedby={assignmentMissing ? `${id}-assignment-error` : undefined}
              onChange={(event) => setScope({ ...scope, assignment: event.target.value })}
            />
            {assignmentMissing && (
              <span id={`${id}-assignment-error`} className="error-text">
                Aufgabenstellung fehlt
              </span>
            )}
          </label>
        </div>
      )}
    </div>
  );
}
