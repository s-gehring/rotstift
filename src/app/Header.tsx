import { protectionSuffix } from '../cloud/protection.ts';
import { ExportMenu } from '../export/ExportMenu.tsx';
import { hasResults } from '../export/has-results.ts';
import { Button } from '../ui/Button.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { SplitButton } from '../ui/Menu.tsx';
import { ProgressBar } from '../ui/ProgressBar.tsx';
import { ROLE_NAME } from '../models/role-text.ts';
import { useApp } from './app-context.tsx';
import { SubjectSelect } from './SubjectSelect.tsx';
import type { ModelRole, RunKind } from './types.ts';

const MAIN_LABEL: Readonly<Record<RunKind, string>> = {
  correct: 'Korrigieren',
  count: 'Wörter zählen',
};

const MENU_LABEL: Readonly<Record<RunKind, string>> = {
  correct: 'Korrigieren',
  count: 'Nur Wörter zählen',
};

function other(kind: RunKind): RunKind {
  return kind === 'correct' ? 'count' : 'correct';
}

function RunStatus() {
  const { run } = useApp();
  const { progress } = run;
  if (progress === null) return null;
  const text = progress.detail === null ? progress.label : `${progress.label} · ${progress.detail}`;
  return (
    <div className="run-status">
      <p className="run-status-text" role="status">
        <span className="run-status-label">{progress.label}</span>
        {progress.detail !== null && <span className="run-status-detail">{progress.detail}</span>}
      </p>
      <ProgressBar label="Fortschritt" value={progress.value} max={progress.max} valueText={text} />
    </div>
  );
}

function MainAction() {
  const { importState, run, navigation, work } = useApp();
  if (importState.arbeiten.length === 0) return null;
  if (run.running) {
    return (
      <Button disabled={run.stopping} onClick={run.cancel}>
        Abbrechen
      </Button>
    );
  }
  const arbeitId = navigation.route.view === 'arbeit' ? navigation.route.arbeitId : undefined;
  const target = arbeitId === undefined ? {} : { arbeitId };
  if (run.done[run.kind]) {
    return (
      <>
        {run.kind === 'count' && !run.done.correct && (
          <>
            <SubjectSelect />
            <Button onClick={() => run.start('correct')}>Korrigieren</Button>
          </>
        )}
        <ExportMenu {...target} />
      </>
    );
  }
  const alternative = other(run.kind);
  return (
    <>
      {hasResults(importState.arbeiten, work.count.state.entries) && (
        <ExportMenu variant="secondary" {...target} />
      )}
      {run.kind === 'correct' && <SubjectSelect />}
      <SplitButton
        label={MAIN_LABEL[run.kind]}
        menuLabel="Weitere Möglichkeiten"
        title={run.estimates[run.kind] ?? undefined}
        disabled={run.checking || run.unavailable !== null}
        onClick={() => run.start()}
        items={[{ label: MENU_LABEL[alternative], onSelect: () => run.start(alternative) }]}
      />
    </>
  );
}

const ROLES: readonly ModelRole[] = ['transcriber', 'corrector', 'reviewer'];

function CloudSign() {
  const { models } = useApp();
  const { steps } = models.cloud;
  if (!ROLES.some((role) => steps[role] !== undefined)) return null;
  const label = ROLES.map((role) => {
    const step = steps[role];
    return step === undefined
      ? `${ROLE_NAME[role]} lokal`
      : `${ROLE_NAME[role]} über ${step.label}${protectionSuffix(step, role)}`;
  }).join(', ');
  return (
    <IconButton
      label={label}
      icon="cloud"
      className="cloud-sign"
      tooltipAlign="end"
      onClick={models.settings.show}
    />
  );
}

export function Header() {
  const { preview, models } = useApp();
  return (
    <header className="app-header">
      <div className="app-header-start">
        <span className="app-title">Rotstift</span>
        {preview && <span className="preview-tag">Vorschau</span>}
      </div>
      <div className="app-header-center">
        <RunStatus />
      </div>
      <div className="app-header-end">
        <CloudSign />
        <MainAction />
        <IconButton
          label="Einstellungen"
          icon="settings"
          tooltipAlign="end"
          onClick={models.settings.show}
        />
      </div>
    </header>
  );
}
