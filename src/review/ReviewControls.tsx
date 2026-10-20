import type { CorrectionProfile } from '../annotations/profile.ts';
import { ProfilePicker } from '../correction/ProfilePicker.tsx';
import type { CorrectorStatus } from '../correction/provider.ts';
import { describeDownloadError } from '../models/format.ts';
import { CheckProgress, checkText } from '../models/ModelCheck.tsx';
import type { DownloadError, ModelStatus } from '../models/types.ts';
import type { TranscriberStatus } from '../pipeline/transcriber.ts';
import type { ReviewState } from './review-flow.ts';

export const PREVIEW_NOTICE =
  'Vorschau: Im Browser liefert ein Platzhalter die Korrekturen. Sie sind erfunden und dienen nur zum Ausprobieren der Ansicht.';

export const PREVIEW_TAG = 'Vorschau';

export const OCR_NOTICE =
  'Lesefehler der Texterkennung können als Fehler erscheinen. Unsicher gelesene Stellen zeigt Rotstift grau gepunktet zur Prüfung.';

export const PDF_FOOTER = 'Vorschau: automatisch erstellte Korrektur, bitte prüfen';

export function PreviewTag() {
  return <span className="preview-tag">{PREVIEW_TAG}</span>;
}

interface ControlsProps {
  readonly state: ReviewState;
  readonly profile: CorrectionProfile;
  readonly onProfile: (profile: CorrectionProfile) => void;
  readonly transcriber: TranscriberStatus | null;
  readonly corrector: CorrectorStatus | null;
  readonly pageCount: number;
  readonly counting: boolean;
  readonly onStart: () => void;
  readonly onOpen: () => void;
  readonly onSetup?: () => void;
}

export function reviewBlocked(
  transcriber: TranscriberStatus | null,
  corrector: CorrectorStatus | null,
): boolean {
  return transcriber?.state !== 'ready' || corrector?.state !== 'ready';
}

export function ReviewControls({
  state,
  profile,
  onProfile,
  transcriber,
  corrector,
  pageCount,
  counting,
  onStart,
  onOpen,
  onSetup,
}: ControlsProps) {
  const running = state.run !== null;
  const hasResults = Object.keys(state.pages).length > 0;
  const setup = corrector?.state === 'needs-model' ? onSetup : undefined;
  const disabled =
    setup === undefined && (reviewBlocked(transcriber, corrector) || pageCount === 0 || counting);
  return (
    <>
      <ProfilePicker value={profile} onChange={onProfile} disabled={running} />
      {running ? (
        <button type="button" className="primary" onClick={onOpen}>
          Berichtigung anzeigen
        </button>
      ) : (
        <button
          type="button"
          className="primary"
          disabled={disabled}
          aria-describedby="review-hint"
          onClick={setup ?? onStart}
        >
          Berichtigen
        </button>
      )}
      <PreviewTag />
      {!running && hasResults && (
        <button type="button" onClick={onOpen}>
          Berichtigung anzeigen
        </button>
      )}
    </>
  );
}

interface HintProps {
  readonly corrector: CorrectorStatus | null;
  readonly onSetup?: () => void;
  readonly onCheckTexts?: () => void;
  readonly check?: ModelStatus | null;
  readonly loadError?: DownloadError | null;
  readonly onRetry?: () => void;
}

export function ReviewHint({
  corrector,
  onSetup,
  onCheckTexts,
  check = null,
  loadError,
  onRetry,
}: HintProps) {
  const checking = corrector?.state === 'needs-model' && check?.state === 'verifying';
  const failed = corrector === null && loadError != null;
  let text: string;
  if (failed)
    text = `Rotstift konnte das Korrekturmodell nicht laden. ${describeDownloadError(loadError)}`;
  else if (corrector === null) text = 'Korrekturmodell wird geladen …';
  else if (corrector.state === 'ready') text = corrector.preview ? PREVIEW_NOTICE : '';
  else if (checking) text = checkText('die Dateien des Korrekturmodells', check);
  else text = corrector.message;
  return (
    <div id="review-hint">
      {text !== '' && (
        <p className={corrector?.state === 'ready' ? 'notice demo' : 'notice'}>
          {text}
          {failed && onRetry !== undefined && (
            <>
              {' '}
              <button type="button" onClick={onRetry}>
                Erneut versuchen
              </button>
            </>
          )}
          {checking && <CheckProgress status={check} label="Prüfung des Korrekturmodells" />}
          {corrector?.state === 'needs-model' && !checking && onSetup !== undefined && (
            <>
              {' '}
              <button type="button" onClick={onSetup}>
                Korrekturmodell einrichten
              </button>
            </>
          )}
        </p>
      )}
      {corrector?.state === 'ready' && (
        <p className="notice">
          {OCR_NOTICE}
          {onCheckTexts !== undefined && (
            <>
              {' '}
              <button type="button" onClick={onCheckTexts}>
                Erkannte Texte prüfen
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}
