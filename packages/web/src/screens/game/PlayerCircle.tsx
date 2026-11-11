import type { WirePlayerView } from '@shaatir-shakuni/socket-api';
import { splitSeatsAroundBoard } from '../../lib/seat-ring';
import { termLimitedNomineeIds } from '../../lib/gameplay-enablement';

type SeatPlayer = WirePlayerView['players'][number];

/**
 * Compact name chips around the decree boards. Seat-frame portraits are
 * omitted — they ate the table on small screens and folded the tracks.
 */
export function PlayerCircle({
  view,
  playerId,
}: {
  readonly view: WirePlayerView;
  readonly playerId: string | null;
}) {
  const seats = [...view.players].sort(
    (a, b) => a.seatOrder - b.seatOrder || a.id.localeCompare(b.id),
  );
  const ring = splitSeatsAroundBoard(seats);

  const chip = (p: SeatPlayer) => (
    <SeatChip key={p.id} view={view} player={p} playerId={playerId} />
  );

  return (
    <div className="contents" data-testid="player-circle">
      <ul
        className="col-start-2 row-start-1 flex min-h-0 items-center justify-center gap-1 px-0.5 sm:gap-1.5"
        aria-label="Players at the north edge"
      >
        {ring.top.map(chip)}
      </ul>
      <ul
        className="col-start-1 row-start-2 flex min-h-0 flex-col items-center justify-center gap-1 py-1"
        aria-label="Players at the west edge"
      >
        {ring.left.map(chip)}
      </ul>
      <ul
        className="col-start-3 row-start-2 flex min-h-0 flex-col items-center justify-center gap-1 py-1"
        aria-label="Players at the east edge"
      >
        {ring.right.map(chip)}
      </ul>
      <ul
        className="col-start-2 row-start-3 flex min-h-0 items-center justify-center gap-1 px-0.5 sm:gap-1.5"
        aria-label="Players at the south edge"
      >
        {ring.bottom.map(chip)}
      </ul>
    </div>
  );
}

function SeatChip({
  view,
  player: p,
  playerId,
}: {
  readonly view: WirePlayerView;
  readonly player: SeatPlayer;
  readonly playerId: string | null;
}) {
  const votes = view.votes ?? view.phase.votes ?? null;
  const revealed = Boolean(view.votesRevealed || view.phase.votesRevealed);
  const voting = view.phase.kind === 'ELECTION_VOTING';
  const deferred = new Set(view.deferredAfkPlayerIds ?? []);
  const knownKaurava = new Set(view.knownKauravas);
  const isYou = p.id === playerId;
  const isMaharajCand = p.id === view.maharajCandidateId;
  const isSenapatiCand = p.id === view.senapatiCandidateId;
  const isGovMaharaj = p.id === view.currentGovernment?.maharajId;
  const isGovSenapati = p.id === view.currentGovernment?.senapatiId;
  const showMaharaj = isGovMaharaj || (isMaharajCand && !view.currentGovernment);
  const showSenapati = isGovSenapati || (isSenapatiCand && !view.currentGovernment);
  const termLimited = termLimitedNomineeIds(view).has(p.id);
  const vote = votes?.[p.id];
  const wasExiled = view.lastExiledPlayerId === p.id || !p.isAlive;
  const isKnownDuryodhana = view.knownDuryodhanaId === p.id;
  const isKnownKauravaTeammate = knownKaurava.has(p.id);

  return (
    <li
      data-testid={`seat-${p.seatOrder}`}
      data-you={isYou ? 'true' : 'false'}
      data-alive={p.isAlive ? 'true' : 'false'}
      className={[
        'relative h-auto w-[4.75rem] flex-none rounded-md border px-1 py-1 text-center shadow-seat sm:w-[5.5rem] sm:px-1.5 sm:py-1.5',
        isYou ? 'border-brass-400 bg-ink-900/95' : 'border-brass-500/30 bg-ink-950/85',
        !p.isAlive ? 'opacity-80' : '',
      ].join(' ')}
    >
      {revealed && vote ? (
        <span
          className={[
            'absolute -right-1 -top-1 z-20 animate-[voteFlip_360ms_ease-out] rounded-full px-1.5 py-0.5 text-xs font-bold',
            vote === 'HA'
              ? 'bg-brass-500 text-ink-950'
              : 'bg-adharma-500 text-mist-100',
          ].join(' ')}
          data-testid={`vote-${p.id}`}
        >
          {vote === 'HA' ? 'Ha' : 'Nahi'}
        </span>
      ) : null}
      {voting && !revealed && p.isAlive ? (
        <span className="absolute -right-1 -top-1 z-20 rounded-full bg-ink-800 px-1.5 py-0.5 text-xs text-mist-300">
          {vote !== undefined ? '✓' : '…'}
        </span>
      ) : null}

      <p className="truncate font-body text-[11px] font-semibold leading-tight text-mist-100 sm:text-xs">
        {p.displayName}
      </p>
      <p className="truncate font-body text-[10px] leading-tight text-mist-400">
        {isYou ? 'You' : `Seat ${p.seatOrder + 1}`}
      </p>

      {showMaharaj ? (
        <p className="truncate font-body text-[10px] font-bold uppercase tracking-wide text-brass-300">
          Maharaj
        </p>
      ) : null}
      {showSenapati ? (
        <p className="truncate font-body text-[10px] font-bold uppercase tracking-wide text-brass-300">
          Senapati
        </p>
      ) : null}
      {isKnownDuryodhana ? (
        <span
          data-testid={`known-duryodhana-seat-${p.id}`}
          className="mt-0.5 block truncate font-body text-[10px] font-bold uppercase tracking-wide text-adharma-400"
        >
          Duryodhana
        </span>
      ) : null}
      {isKnownKauravaTeammate ? (
        <span
          data-testid={`known-kaurava-seat-${p.id}`}
          className="mt-0.5 block truncate font-body text-[10px] font-bold uppercase tracking-wide text-adharma-400"
        >
          Kaurava
        </span>
      ) : null}
      {!p.isAlive ? (
        <span className="block font-body text-[10px] font-bold uppercase tracking-wide text-ash-400">
          {wasExiled ? 'Exiled' : 'Gone'}
        </span>
      ) : null}
      {deferred.has(p.id) && p.isAlive ? (
        <span className="block font-body text-[10px] text-brass-400">Bot waits</span>
      ) : null}
      {termLimited && view.phase.kind === 'ELECTION_NOMINATION' ? (
        <span className="block font-body text-[10px] uppercase text-mist-400">Limit</span>
      ) : null}
      {isMaharajCand && view.currentGovernment ? (
        <span className="block font-body text-[10px] uppercase text-mist-400">Next</span>
      ) : null}
    </li>
  );
}
