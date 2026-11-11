import type { WirePlayerView } from '@shaatir-shakuni/socket-api';
import { useAfkCountdown } from '../../hooks/useAfkCountdown';
import {
  isCeremonyPhase,
  phaseNarration,
  phaseTitle,
} from '../../lib/phase-banner-copy';
import { isDuryodhanaSenapatiThreatActive } from '../../lib/court-announcement';

export function PhaseBanner({
  view,
  roomCode,
  showActorCountdown,
}: {
  readonly view: WirePlayerView;
  readonly roomCode: string | null;
  /** AFK countdown when this seat still owes an action. */
  readonly showActorCountdown: boolean;
}) {
  const countdown = useAfkCountdown();
  const ceremony = isCeremonyPhase(view);
  const showCountdown = Boolean(countdown) && (showActorCountdown || ceremony);

  return (
    <header className="text-center" data-testid="phase-banner">
      <h1 className="font-display text-lg font-bold text-mist-100 sm:text-2xl">
        {phaseTitle(view.phase.kind)}
      </h1>
      <p className="hidden font-body text-xs font-semibold uppercase tracking-[0.28em] text-brass-400/80 sm:mt-1 sm:block">
        Loaded Dice
      </p>
      <p
        className="mx-auto mt-1 max-w-2xl font-body text-xs leading-snug text-mist-200 sm:mt-2 sm:text-sm sm:leading-relaxed"
        data-testid="phase-narration"
      >
        {phaseNarration(view)}
      </p>
      <p className="mt-1 font-body text-[10px] text-mist-400 sm:mt-2 sm:text-xs">
        Room {roomCode ?? view.roomId.slice(0, 8)}
        {view.vetoUnlocked ? " · Shakuni's Dice unlocked" : ''}
      </p>
      {/* Reserved line — prevents layout jump when AFK countdown appears/disappears. */}
      <p
        className="mt-1 min-h-[1rem] font-body text-xs text-brass-400 sm:mt-2 sm:min-h-[1.25rem] sm:text-sm"
        data-testid="afk-countdown"
        title="Display only — server decides deadlines"
      >
        {showCountdown
          ? `${ceremony ? 'Continuing in ' : 'Your turn ends in '}${countdown}`
          : '\u00a0'}
      </p>
      {isDuryodhanaSenapatiThreatActive(view) ? (
        <p
          className="mx-auto mt-1 max-w-2xl rounded-md border border-adharma-400/40 bg-adharma-600/15 px-3 py-1.5 font-body text-xs text-adharma-300 sm:text-sm"
          data-testid="duryodhana-senapati-warning-banner"
          role="status"
        >
          Warning: Duryodhana as Senapati now wins for the Kauravas.
        </p>
      ) : null}
      {view.isSpectator ? (
        <p className="mt-1 font-body text-sm text-clay-400" role="status">
          You are spectating (exiled). You cannot submit actions.
        </p>
      ) : null}
    </header>
  );
}
