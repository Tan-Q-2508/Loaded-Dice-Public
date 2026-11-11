import type { ReactNode } from 'react';
import type { WirePlayerView } from '@shaatir-shakuni/socket-api';
import { LegislationTheater } from './LegislationTheater';
import { PhaseBanner } from './PhaseBanner';
import { PlayerCircle } from './PlayerCircle';
import { PolicyTracks } from './PolicyTracks';
import { PrivateKnowledgeStrip } from './PrivateKnowledgeStrip';
import { CourtOverlay } from './CourtOverlay';
import { boardArt } from '../../lib/board-art';

/**
 * Court tabletop: decree boards stay fully visible in the center; seats
 * sit on the four edges. No bottom player strip that folds the tracks.
 */
export function BoardChrome({
  view,
  roomCode,
  animationEpoch,
  playerId,
  showAfkCountdown = true,
  prompt = null,
}: {
  readonly view: WirePlayerView;
  readonly roomCode: string | null;
  readonly animationEpoch: number;
  readonly playerId: string | null;
  readonly showAfkCountdown?: boolean;
  /** On-table action prompt — must stay in the viewport (no page-scroll dock). */
  readonly prompt?: ReactNode;
}) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-animation-epoch={animationEpoch}
      data-testid="game-board"
      data-phase={view.phase.kind}
    >
      <div className="shrink-0">
        <PhaseBanner
          view={view}
          roomCode={roomCode}
          showActorCountdown={showAfkCountdown}
        />
        <PrivateKnowledgeStrip view={view} />
      </div>
      <div
        className="court-table relative mt-1 min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-[1.25rem] shadow-table sm:mt-2 sm:rounded-[1.75rem]"
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(15,12,10,0.55), rgba(15,12,10,0.72)), url(${boardArt.tableFelt})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {/* min-h-full (not h-full): on a viewport too short to fit seats +
            boards, rows grow to their natural size and court-table (above)
            scrolls, instead of silently clipping the Adharma board or
            stacking the north/south seat rows on top of each other. */}
        <div className="relative grid min-h-full grid-cols-[minmax(4.75rem,auto)_minmax(0,1fr)_minmax(4.75rem,auto)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0.5 p-1 sm:grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)_minmax(5.5rem,auto)] sm:gap-1 sm:p-2">
          <PlayerCircle view={view} playerId={playerId} />
          <div className="relative col-start-2 row-start-2 flex min-h-0 flex-col">
            <div
              className="flex min-h-0 flex-1 flex-col justify-center"
              data-testid="decree-boards"
            >
              <PolicyTracks view={view} />
              <LegislationTheater view={view} />
            </div>
          </div>
          {prompt ? <CourtOverlay>{prompt}</CourtOverlay> : null}
        </div>
      </div>
    </div>
  );
}
