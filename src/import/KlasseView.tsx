import { useApp } from '../app/app-context.tsx';
import { Button } from '../ui/Button.tsx';
import { ImportView } from './ImportView.tsx';

export function KlasseView() {
  const { importState, run, work, navigation } = useApp();
  const hasResults =
    Object.keys(work.count.state.entries).length > 0 ||
    Object.keys(work.review.state.pages).length > 0;
  return (
    <div className="klasse-view">
      {hasResults && importState.arbeiten.length > 0 && (
        <div className="klasse-view-tools">
          <Button variant="quiet" onClick={navigation.openOverview}>
            Übersicht
          </Button>
        </div>
      )}
      <ImportView
        importState={importState}
        locked={run.running}
        {...(hasResults && { onOpenArbeit: navigation.openArbeit })}
      />
    </div>
  );
}
