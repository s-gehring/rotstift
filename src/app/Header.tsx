import { ExportMenu } from '../export/ExportMenu.tsx';
import { Button } from '../ui/Button.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { SplitButton } from '../ui/Menu.tsx';
import { ProgressBar } from '../ui/ProgressBar.tsx';
import { useApp } from './app-context.tsx';
import { SubjectSelect } from './SubjectSelect.tsx';
import type { RunKind } from './types.ts';

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
  const { importState, run, navigation } = useApp();
  if (importState.arbeiten.length === 0) return null;
  if (run.running) {
    return (
      <Button disabled={run.stopping} onClick={run.cancel}>
        Abbrechen
      </Button>
    );
  }
  if (run.done[run.kind]) {
    const arbeitId = navigation.route.view === 'arbeit' ? navigation.route.arbeitId : undefined;
    return (
      <>
        {run.kind === 'count' && !run.done.correct && (
          <>
            <SubjectSelect />
            <Button onClick={() => run.start('correct')}>Korrigieren</Button>
          </>
        )}
        <ExportMenu {...(arbeitId !== undefined && { arbeitId })} />
      </>
    );
  }
  const alternative = other(run.kind);
  return (
    <>
      {run.kind === 'correct' && <SubjectSelect />}
      <SplitButton
        label={MAIN_LABEL[run.kind]}
        menuLabel="Weitere Möglichkeiten"
        disabled={run.checking || run.unavailable !== null}
        onClick={() => run.start()}
        items={[{ label: MENU_LABEL[alternative], onSelect: () => run.start(alternative) }]}
      />
    </>
  );
}

export function Header() {
  const { demo, models } = useApp();
  return (
    <header className="app-header">
      <div className="app-header-start">
        <span className="app-title">Rotstift</span>
        {demo && <span className="demo-tag">Demo</span>}
      </div>
      <div className="app-header-center">
        <RunStatus />
      </div>
      <div className="app-header-end">
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
