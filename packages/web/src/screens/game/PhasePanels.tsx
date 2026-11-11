import { useState, type ReactNode } from 'react';
import type { WirePlayerView } from '@shaatir-shakuni/socket-api';
import {
  canAckRoleReveal,
  canActAsMaharajVeto,
  canActAsSenapati,
  canCastVote,
  canDiscardMaharajTile,
  canDoneDiscussing,
  canExecPower,
  canNominate,
  canProposeVeto,
  eligibleNominees,
  livingOtherPlayers,
  maharajTiles,
  senapatiTiles,
  termLimitedNomineeIds,
} from '../../lib/gameplay-enablement';
import { courtAnnouncement } from '../../lib/court-announcement';
import { AnnouncementBlock } from './CourtOverlay';
import { decreeTileArt, roleCardArt, voteBallotArt } from '../../lib/board-art';
import {
  isHostForceEnd,
  revealRowsFromPlayers,
  roleLabel,
  teamForRole,
  teamLabel,
  winReasonLabel,
} from '../../lib/theme-labels';
import type { PendingSelection } from '../../store/gameStore';

type SelectionDraft = Omit<PendingSelection, 'phaseKind' | 'stateVersion'>;

type PanelProps = {
  readonly view: WirePlayerView;
  readonly playerId: string | null;
  readonly writable: boolean;
  readonly pending: PendingSelection | null;
  readonly onSelect: (selection: SelectionDraft) => void;
  readonly onSubmit: (immediate?: SelectionDraft) => void;
  /** EC-88 — never used to disable actions; present so callers cannot forget the rule. */
  readonly animationBlocksActions: false;
};

function SubmitRow({
  writable,
  canSubmit,
  onSubmit,
  label,
  testId,
}: {
  readonly writable: boolean;
  readonly canSubmit: boolean;
  readonly onSubmit: () => void;
  readonly label: string;
  readonly testId?: string;
}) {
  return (
    <button
      type="button"
      disabled={!writable || !canSubmit}
      onClick={onSubmit}
      data-testid={testId}
      className="mt-6 min-h-11 w-full rounded-md bg-brass-500 px-4 py-3 font-body text-sm font-semibold text-ink-950 transition hover:bg-brass-400 disabled:hover:bg-brass-500"
    >
      {label}
    </button>
  );
}

function DecreeTileChoice({
  tile,
  disabled,
  onClick,
}: {
  readonly tile: { readonly id: string; readonly type: 'DHARMA' | 'ADHARMA' };
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-testid={`tile-${tile.id}`}
      className="flex min-h-11 min-w-11 flex-col items-center gap-1 rounded-md border border-brass-400/40 bg-ink-950/70 p-1.5 transition hover:border-brass-300 disabled:hover:border-brass-400/40"
    >
      <img
        src={decreeTileArt(tile.type)}
        alt={`Discard ${tile.type}`}
        className="h-[4.25rem] w-auto object-contain sm:h-28"
        draggable={false}
      />
      <span className="font-body text-xs text-mist-200">Discard {tile.type}</span>
    </button>
  );
}

function VoteBallotCard({
  vote,
  disabled,
  onClick,
}: {
  readonly vote: 'HA' | 'NAHI';
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  const ha = vote === 'HA';
  const [artFailed, setArtFailed] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-testid={ha ? 'vote-ha' : 'vote-nahi'}
      className="flex min-h-11 min-w-11 flex-col items-center rounded-md bg-transparent p-0 transition hover:brightness-110 disabled:opacity-60"
    >
      <img
        src={voteBallotArt(vote)}
        alt={ha ? 'HA — yes' : 'NAHI — no'}
        className={`h-28 w-auto object-contain sm:h-36 md:h-44 ${artFailed ? 'hidden' : ''}`}
        draggable={false}
        onError={() => setArtFailed(true)}
      />
      {artFailed ? (
        <span
          className={`flex h-28 min-w-[6.5rem] items-center justify-center rounded-md border font-display text-3xl font-bold tracking-[0.18em] sm:h-36 md:h-44 ${
            ha
              ? 'border-brass-400/50 bg-[#e8d4b0] text-[#8a6a1f]'
              : 'border-adharma-400/50 bg-[#5c221c] text-[#e8b4a8]'
          }`}
          aria-hidden
        >
          {ha ? 'HA' : 'NAHI'}
        </span>
      ) : null}
    </button>
  );
}

function ChoiceButton({
  active,
  disabled,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`min-h-11 min-w-11 rounded-md border px-3 py-2 font-body text-sm transition ${
        active
          ? 'border-brass-400 bg-brass-500/20 text-mist-100'
          : 'border-mist-300/25 text-mist-200 hover:border-mist-300/50'
      }`}
    >
      {children}
    </button>
  );
}

export function RoleRevealPanel({
  view,
  playerId,
  writable,
  onSubmit,
  animationBlocksActions,
}: PanelProps) {
  void animationBlocksActions;
  const canAck = canAckRoleReveal(view, playerId);
  const team = view.ownTeam;
  const role = view.ownRole;
  const duryodhanaName = view.knownDuryodhanaId
    ? view.players.find((p) => p.id === view.knownDuryodhanaId)?.displayName ??
      view.knownDuryodhanaId.slice(0, 6)
    : null;
  const knownTeammates = view.knownKauravas
    .map((id) => view.players.find((p) => p.id === id)?.displayName ?? id.slice(0, 6))
    .filter(Boolean);

  const cardArt = roleCardArt(role);

  return (
    <section
      aria-labelledby="role-heading"
      className="animate-revealCurtain flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto text-center"
      data-testid="role-reveal-panel"
    >
      <p className="font-body text-xs font-semibold uppercase tracking-[0.4em] text-brass-400">
        Private reveal
      </p>
      <p
        className={`mt-6 font-display text-3xl sm:text-4xl ${
          team === 'KAURAVA' ? 'text-adharma-400' : 'text-dharma-400'
        }`}
        data-testid="role-party"
      >
        {teamLabel(team)}
      </p>
      <h2 id="role-heading" className="sr-only">
        {roleLabel(role)}
      </h2>
      {cardArt ? (
        <img
          src={cardArt}
          alt={roleLabel(role)}
          data-testid="role-card"
          className="mt-5 h-auto w-[13rem] max-w-[70vw] rounded-lg border border-brass-500/35 shadow-[0_18px_40px_rgba(0,0,0,0.45)] sm:w-[15rem]"
          draggable={false}
        />
      ) : (
        <p
          className="mt-4 font-display text-5xl font-bold text-mist-100 sm:text-6xl"
          data-testid="role-card"
        >
          {roleLabel(role)}
        </p>
      )}

      {role === 'KAURAVA' ? (
        <p
          className="mt-8 max-w-md rounded-lg border border-adharma-500/40 bg-adharma-600/20 px-4 py-3 font-body text-lg text-mist-100"
          data-testid="known-duryodhana"
        >
          {duryodhanaName ? (
            <>
              Duryodhana is{' '}
              <span className="font-semibold text-brass-300">{duryodhanaName}</span>
            </>
          ) : (
            <>Duryodhana’s identity did not sync — reconnect if this persists.</>
          )}
        </p>
      ) : null}

      {role === 'DURYODHANA' ? (
        <p className="mt-8 max-w-md font-body text-base text-mist-300">
          You are Duryodhana. Keep your identity hidden — the Kauravas know who you are.
        </p>
      ) : null}

      {knownTeammates.length > 0 ? (
        <div className="mt-6 max-w-md" data-testid="known-kauravas">
          <p className="font-body text-xs uppercase tracking-[0.2em] text-mist-400">
            {role === 'DURYODHANA' ? 'Known Kauravas' : 'Other Kauravas'}
          </p>
          <p className="mt-2 font-body text-base text-mist-200">
            {knownTeammates.join(' · ')}
          </p>
        </div>
      ) : null}

      {canAck ? (
        <SubmitRow
          writable={writable}
          canSubmit
          onSubmit={() => onSubmit({ kind: 'ack', value: 'ack' })}
          label="I have seen my role"
          testId="ack-role"
        />
      ) : (
        <p className="mt-10 font-body text-sm text-mist-300">Waiting for others…</p>
      )}
    </section>
  );
}

export function DiscussionPanel({
  view,
  playerId,
  writable,
  onSubmit,
  animationBlocksActions,
}: PanelProps) {
  void animationBlocksActions;
  const can = canDoneDiscussing(view, playerId);
  const announcement = courtAnnouncement(view);
  return (
    <section aria-labelledby="discuss-heading" data-testid="discussion-panel">
      {announcement ? (
        <AnnouncementBlock
          title={announcement.title}
          body={announcement.body}
          headingId="discuss-heading"
          testId={
            announcement.kind === 'duryodhana-senapati-warning'
              ? 'duryodhana-senapati-warning'
              : undefined
          }
        />
      ) : (
        <h2 id="discuss-heading" className="font-display text-lg text-mist-100 sm:text-xl">
          Table discussion
        </h2>
      )}
      <p className="mt-3 font-body text-sm text-mist-300">
        {can
          ? 'Talk it out. Ready up when you are done — or wait for the timer.'
          : 'You’re ready — waiting for the rest of the table…'}
      </p>
      {can ? (
        <SubmitRow
          writable={writable}
          canSubmit
          onSubmit={() => onSubmit({ kind: 'doneDiscussing', value: 'done' })}
          label="Done discussing"
          testId="done-discussing"
        />
      ) : (
        <p className="mt-3 font-body text-sm text-mist-400" data-testid="discussion-waiting">
          Waiting for others…
        </p>
      )}
    </section>
  );
}

export function NominationPanel({
  view,
  playerId,
  writable,
  pending,
  onSelect,
  onSubmit,
  animationBlocksActions,
}: PanelProps) {
  void pending;
  void onSelect;
  void animationBlocksActions;
  const can = canNominate(view, playerId);
  const announcement = courtAnnouncement(view);
  const candidates = eligibleNominees(view, playerId);
  const limited = termLimitedNomineeIds(view);

  // #region agent log
  fetch('http://127.0.0.1:7361/ingest/3fd40a7f-41cf-45a6-ac18-e83e0fd4bfa6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fd802b'},body:JSON.stringify({sessionId:'fd802b',hypothesisId:'H1',location:'PhasePanels.tsx:NominationPanel',message:'nomination candidates after term-limit filter',data:{can,living:view.players.filter((p)=>p.isAlive).length,lastGov:view.lastElectedGovernment,eligibleIds:candidates.map((p)=>p.id),limitedIds:[...limited]},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  return (
    <section aria-labelledby="nom-heading" data-testid="nomination-panel">
      {announcement ? (
        <AnnouncementBlock
          title={announcement.title}
          body={announcement.body}
          headingId="nom-heading"
        />
      ) : (
        <h2 id="nom-heading" className="font-display text-xl text-mist-100">
          Nominate Senapati
        </h2>
      )}
      {can ? (
        <>
          <p className="mt-3 font-body text-sm text-mist-300">
            Choose a living player who is not term-limited (Rajya Maryada).
            {limited.size > 0
              ? ' The last elected government cannot be nominated again.'
              : ''}
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {candidates.map((p) => (
              <li key={p.id}>
                <ChoiceButton
                  active={false}
                  disabled={!writable}
                  onClick={() => onSubmit({ kind: 'nominee', value: p.id })}
                >
                  <span data-testid={`nominate-${p.id}`}>{p.displayName}</span>
                </ChoiceButton>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-3 font-body text-sm text-mist-400" data-testid="nomination-waiting">
          Waiting for the Maharaj to choose…
        </p>
      )}
    </section>
  );
}

export function VotingPanel({
  view,
  playerId,
  writable,
  pending,
  onSelect,
  onSubmit,
  animationBlocksActions,
}: PanelProps) {
  void pending;
  void onSelect;
  void animationBlocksActions;
  const can = canCastVote(view, playerId);
  const revealed = view.votesRevealed || view.phase.votesRevealed;
  const gov = `${view.players.find((p) => p.id === view.maharajCandidateId)?.displayName ?? '?'} + ${
    view.players.find((p) => p.id === view.senapatiCandidateId)?.displayName ?? '?'
  }`;

  // Reveal is shown on the player circle; waiters need no duplicate panel.
  if (revealed || !can) {
    return null;
  }

  return (
    <section aria-labelledby="vote-heading" data-testid="voting-panel">
      <h2 id="vote-heading" className="font-display text-xl text-mist-100">
        Your ballot
      </h2>
      <p className="mt-1 font-body text-sm text-mist-300">
        {gov}. Tap a ballot to cast.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-4">
        <VoteBallotCard
          vote="HA"
          disabled={!writable}
          onClick={() => onSubmit({ kind: 'vote', value: 'HA' })}
        />
        <VoteBallotCard
          vote="NAHI"
          disabled={!writable}
          onClick={() => onSubmit({ kind: 'vote', value: 'NAHI' })}
        />
      </div>
    </section>
  );
}

export function LegislationMaharajPanel({
  view,
  playerId,
  writable,
  pending,
  onSelect,
  onSubmit,
  animationBlocksActions,
}: PanelProps) {
  void pending;
  void onSelect;
  void animationBlocksActions;
  const can = canDiscardMaharajTile(view, playerId);
  const tiles = maharajTiles(view);
  const amMaharaj = view.currentGovernment?.maharajId === playerId;

  if (!can) {
    if (amMaharaj) {
      return (
        <section>
          <h2 className="font-display text-xl text-mist-100">Your decrees</h2>
          <p className="mt-3 font-body text-sm text-mist-300">
            Waiting for your decrees to arrive… If this stays empty, exit and reconnect.
          </p>
        </section>
      );
    }
    return null;
  }

  return (
    <section aria-labelledby="mah-leg-heading" data-testid="legislation-maharaj-panel">
      <h2 id="mah-leg-heading" className="font-display text-xl text-mist-100">
        Discard one decree
      </h2>
      <p className="mt-2 font-body text-sm text-mist-300">
        Pass the remaining two to the Senapati. Discarded tiles stay face-down.
      </p>
      <ul className="mt-3 flex flex-wrap justify-center gap-2">
        {tiles.map((t) => (
          <li key={t.id}>
            <DecreeTileChoice
              tile={t}
              disabled={!writable}
              onClick={() => onSubmit({ kind: 'tile', value: t.id })}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LegislationSenapatiPanel({
  view,
  playerId,
  writable,
  pending,
  onSelect,
  onSubmit,
  animationBlocksActions,
}: PanelProps) {
  void onSelect;
  void animationBlocksActions;
  const isSenapati = canActAsSenapati(view, playerId);
  const isMaharajVeto = canActAsMaharajVeto(view, playerId);
  const tiles = senapatiTiles(view);
  const vetoProposed = Boolean(view.phase.vetoProposed);

  if (!isSenapati && !isMaharajVeto) {
    return null;
  }

  return (
    <section aria-labelledby="sen-leg-heading" data-testid="legislation-senapati-panel">
      <h2 id="sen-leg-heading" className="font-display text-xl text-mist-100">
        {vetoProposed ? 'Veto vote' : 'Discard one decree'}
      </h2>

      {vetoProposed && (isSenapati || isMaharajVeto) ? (
        <>
          <p className="mt-2 font-body text-sm text-mist-300">
            Both Maharaj and Senapati must agree to veto.
          </p>
          <div className="mt-4 flex gap-3">
            <ChoiceButton
              active={pending?.kind === 'vetoVote' && pending.value === 'HA'}
              disabled={!writable}
              onClick={() => onSubmit({ kind: 'vetoVote', value: 'HA' })}
            >
              <span data-testid="veto-ha">Agree (veto)</span>
            </ChoiceButton>
            <ChoiceButton
              active={pending?.kind === 'vetoVote' && pending.value === 'NAHI'}
              disabled={!writable}
              onClick={() => onSubmit({ kind: 'vetoVote', value: 'NAHI' })}
            >
              <span data-testid="veto-nahi">Disagree</span>
            </ChoiceButton>
          </div>
        </>
      ) : null}

      {isSenapati && !vetoProposed ? (
        <>
          <p className="mt-2 font-body text-sm text-mist-300">
            Tap one decree to discard face-down. The other is enacted.
          </p>
          <ul className="mt-3 flex flex-wrap justify-center gap-2">
            {tiles.map((t) => (
              <li key={t.id}>
                <DecreeTileChoice
                  tile={t}
                  disabled={!writable}
                  onClick={() => onSubmit({ kind: 'tile', value: t.id })}
                />
              </li>
            ))}
          </ul>
          {tiles.length === 0 ? (
            <p className="mt-4 font-body text-sm text-clay-500">
              No decrees in hand — reconnect if this persists.
            </p>
          ) : null}
          {canProposeVeto(view, playerId) ? (
            <button
              type="button"
              data-testid="propose-veto"
              disabled={!writable}
              onClick={() => onSubmit({ kind: 'proposeVeto', value: 'veto' })}
              className="mt-3 min-h-11 w-full rounded-md border border-mist-300/25 px-4 py-3 font-body text-sm text-mist-200"
            >
              Propose Shakuni&apos;s Dice (veto)
            </button>
          ) : null}
        </>
      ) : null}

      {isSenapati && vetoProposed ? (
        <>
          <p className="mt-6 font-body text-xs text-mist-300">
            Or enact normally instead of waiting on the veto:
          </p>
          <ul className="mt-2 flex flex-wrap justify-center gap-2">
            {tiles.map((t) => (
              <li key={t.id}>
                <DecreeTileChoice
                  tile={t}
                  disabled={!writable}
                  onClick={() => onSubmit({ kind: 'tile', value: t.id })}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

export function ExecutivePanel({
  view,
  playerId,
  writable,
  pending,
  onSelect,
  onSubmit,
  animationBlocksActions,
}: PanelProps) {
  void animationBlocksActions;
  const can = canExecPower(view, playerId);
  const power = view.phase.power;
  const targets = livingOtherPlayers(view, playerId);
  const peeks = view.peekedTiles.length > 0 ? view.peekedTiles : (view.phase.peekedTiles ?? []);
  const investigations = view.ownInvestigations;

  if (!can) {
    return null;
  }

  if (power === 'AKASHVANI') {
    return (
      <section>
        <h2 className="font-display text-2xl text-mist-100">Akashvani</h2>
        <p className="mt-2 font-body text-sm text-mist-300">Top three decrees (private):</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {peeks.map((t) => (
            <li
              key={t.id}
              className="rounded-md border border-mist-300/25 px-3 py-2 font-body text-sm text-mist-100"
            >
              {t.type}
            </li>
          ))}
        </ul>
        <SubmitRow
          writable={writable}
          canSubmit
          onSubmit={() => onSubmit({ kind: 'akashvani', value: 'ack' })}
          label="Acknowledge"
          testId="ack-akashvani"
        />
      </section>
    );
  }

  const title =
    power === 'DIVYA_DRISHTI'
      ? 'Divya Drishti — investigate'
      : power === 'RAJYA_SABHA_SUMMONS'
        ? 'Rajya Sabha Summons'
        : 'Vanvas — exile';

  void pending;
  void onSelect;

  return (
    <section data-testid="executive-panel">
      <h2 className="font-display text-xl text-mist-100">{title}</h2>
      <p className="mt-2 font-body text-sm text-mist-300">
        Choose a living player. Discuss first if you need to — then tap once.
      </p>
      {investigations.length > 0 ? (
        <ul className="mt-3 font-body text-sm text-mist-300">
          {investigations.map((i) => (
            <li key={i.targetPlayerId}>
              {view.players.find((p) => p.id === i.targetPlayerId)?.displayName ??
                i.targetPlayerId.slice(0, 6)}
              : {i.team}
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {targets.map((p) => (
          <li key={p.id}>
            <ChoiceButton
              active={false}
              disabled={!writable}
              onClick={() => onSubmit({ kind: 'target', value: p.id })}
            >
              <span data-testid={`exec-target-${p.id}`}>{p.displayName}</span>
            </ChoiceButton>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FrozenPanel({
  mode,
}: {
  readonly mode: 'FROZEN' | 'CORRUPTED' | null;
}) {
  return (
    <section>
      <h2 className="font-display text-2xl text-mist-100">
        {mode === 'CORRUPTED' ? 'Game corrupted' : 'Game frozen'}
      </h2>
      <p className="mt-4 font-body text-sm text-mist-300">
        This game cannot continue. Connections stay open; further actions are blocked.
      </p>
    </section>
  );
}

/**
 * Full GAME_OVER reveal — winner, win reason, and all revealedRole rows.
 * Display-only; never recomputes wins or invents missing roles.
 */
export function GameOverPanel({
  view,
  onPlayAgain,
}: {
  readonly view: WirePlayerView;
  readonly onPlayAgain?: () => void;
}) {
  const winner = view.winner ?? view.phase.winner ?? null;
  const reason =
    view.winReason ??
    (typeof view.phase.reason === 'string' ? view.phase.reason : null);
  const hostEnded = isHostForceEnd(reason);
  const rows = revealRowsFromPlayers(view.players);
  const winners = rows.filter(
    (row) => row.revealedRole && teamForRole(row.revealedRole) === winner,
  );

  return (
    <section
      aria-labelledby="gameover-heading"
      className="animate-revealCurtain flex h-full min-h-0 flex-col items-center overflow-hidden px-2 py-3 text-center sm:py-6"
      data-testid="game-over-panel"
    >
      <p className="font-body text-xs font-semibold uppercase tracking-[0.35em] text-brass-400">
        The court is closed
      </p>
      <h2
        id="gameover-heading"
        className={`mt-4 font-display text-4xl font-bold sm:text-5xl ${
          winner === 'KAURAVA' ? 'text-adharma-400' : 'text-dharma-400'
        }`}
        data-testid="game-over-winner"
      >
        {teamLabel(winner)} win
      </h2>
      <p
        className={`mt-4 max-w-lg font-body text-base ${
          hostEnded ? 'text-clay-400' : 'text-mist-200'
        }`}
        data-testid="game-over-reason"
        data-host-force-end={hostEnded ? 'true' : 'false'}
      >
        {winReasonLabel(reason)}
      </p>

      {onPlayAgain ? (
        <button
          type="button"
          data-testid="play-again"
          onClick={onPlayAgain}
          className="mt-5 min-h-11 w-full max-w-sm shrink-0 rounded-md bg-brass-500 px-4 py-3 font-body text-sm font-semibold text-ink-950 transition hover:bg-brass-400"
        >
          Play Again
        </button>
      ) : null}

      <div className="mt-6 min-h-0 w-full max-w-2xl shrink overflow-y-auto sm:mt-8">
        <h3 className="font-display text-lg text-mist-100">Victors</h3>
        <ul className="mt-4 flex flex-wrap justify-center gap-3" data-testid="game-over-winners">
          {winners.map((row) => (
            <li
              key={row.id}
              className="rounded-xl border border-brass-400/40 bg-brass-500/10 px-4 py-3"
            >
              <p className="font-body text-sm font-semibold text-mist-100">{row.displayName}</p>
              <p className="mt-1 font-body text-xs text-brass-300">
                {roleLabel(row.revealedRole)}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <h3 className="mt-6 shrink-0 font-display text-lg text-mist-100 sm:mt-8">Full reveal</h3>
      <ul className="mt-3 min-h-0 w-full max-w-xl flex-1 space-y-2 overflow-y-auto text-left" data-testid="game-over-reveal">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-brass-500/15 bg-ink-950/40 px-3 py-2.5 font-body text-sm"
            data-seat={row.seatOrder}
            data-role={row.revealedRole ?? ''}
          >
            <span className="text-mist-100">
              {row.displayName}
              {!row.isAlive ? (
                <span className="ml-2 text-xs text-ash-400">(exiled)</span>
              ) : null}
            </span>
            <span className="text-mist-200">
              {roleLabel(row.revealedRole)}
              {row.revealedRole ? (
                <span className="ml-2 text-xs text-mist-400">
                  · {teamLabel(teamForRole(row.revealedRole))}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** @deprecated Use GameOverPanel — kept name alias for any stray imports. */
export const MinimalGameOverPanel = GameOverPanel;
