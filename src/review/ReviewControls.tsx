import type { CorrectionProfile } from '../annotations/profile.ts';
import { ProfilePicker } from '../correction/ProfilePicker.tsx';
import type { CorrectorStatus } from '../correction/provider.ts';
import type { TranscriberStatus } from '../pipeline/transcriber.ts';
import type { ReviewState } from './review-flow.ts';

export const PREVIEW_NOTICE =
  'Vorschau: Im Browser liefert ein Platzhalter die Korrekturen. Sie sind erfunden und dienen nur zum Ausprobieren der Ansicht.';

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
}

export function ReviewHint({ corrector, onSetup }: HintProps) {
  let text: string;
  if (corrector === null) text = 'Korrekturmodell wird geprüft …';
  else if (corrector.state === 'ready') text = corrector.preview ? PREVIEW_NOTICE : '';
  else text = corrector.message;
  return (
    <div id="review-hint">
      {text !== '' && (
        <p className={corrector?.state === 'ready' ? 'notice demo' : 'notice'}>
          {text}
          {corrector?.state === 'needs-model' && onSetup !== undefined && (
            <>
              {' '}
              <button type="button" onClick={onSetup}>
                Korrekturmodell einrichten
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}
