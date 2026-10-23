import { useCallback } from 'react';
import { KlasseView } from '../import/KlasseView.tsx';
import { useFileDrop } from '../import/use-file-drop.ts';
import { SettingsDialog } from '../models/SettingsDialog.tsx';
import { SetupDialog } from '../models/SetupDialog.tsx';
import { PrivacyReviewDialog } from '../privacy-review/PrivacyReviewDialog.tsx';
import { ArbeitView } from '../review/ArbeitView.tsx';
import { ClassOverviewDialog } from '../review/ClassOverviewDialog.tsx';
import { ToastRegion } from '../ui/Toast.tsx';
import { useApp } from './app-context.tsx';
import { Header } from './Header.tsx';

export function Shell() {
  const { navigation, toasts, importState, run } = useApp();
  const { addFiles } = importState;
  const { running } = run;
  const onFiles = useCallback(
    (files: File[]) => {
      if (!running) addFiles(files);
    },
    [addFiles, running],
  );
  const dropActive = useFileDrop(onFiles) && !running;
  const { route } = navigation;
  return (
    <div className="app">
      <Header />
      <main className="app-main">
        {route.view === 'arbeit' ? <ArbeitView arbeitId={route.arbeitId} /> : <KlasseView />}
      </main>
      <SetupDialog />
      <SettingsDialog />
      <ClassOverviewDialog />
      <PrivacyReviewDialog />
      <ToastRegion toasts={toasts} />
      {dropActive && (
        <div className="drop-overlay" aria-hidden="true">
          Dateien hier loslassen
        </div>
      )}
    </div>
  );
}
