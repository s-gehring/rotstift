import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cleanAssignment, MAX_ASSIGNMENT_LENGTH, toggleKind } from '../correction/scope.ts';
import type { ScopeKind } from '../correction/scope.ts';
import { Button } from '../ui/Button.tsx';
import { Icon } from '../ui/icons.tsx';
import { useApp } from './app-context.tsx';

const KINDS: readonly { readonly kind: ScopeKind; readonly label: string }[] = [
  { kind: 'spelling', label: 'Rechtschreibung' },
  { kind: 'grammar', label: 'Grammatik' },
];

export function SubjectSelect() {
  const { subject, run } = useApp();
  const { scope, setScope } = subject;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLSelectElement>(null);
  const id = useId();
  const withAssignment = cleanAssignment(scope.assignment) !== '';
  const isOpen = open && !run.running;

  useEffect(() => {
    if (!isOpen) return undefined;
    first.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || anchor.current?.contains(event.target) !== true) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  const close = () => {
    setOpen(false);
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
        if (next instanceof Node && !event.currentTarget.contains(next)) setOpen(false);
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
        onClick={() => setOpen((current) => !current)}
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
                  onChange={() => setScope(toggleKind(scope, kind))}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="scope-field">
            <span>Aufgabenstellung</span>
            <textarea
              rows={4}
              maxLength={MAX_ASSIGNMENT_LENGTH}
              placeholder="z. B. Schreibe einen Brief an deine Großeltern."
              value={scope.assignment}
              onChange={(event) => setScope({ ...scope, assignment: event.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  );
}
