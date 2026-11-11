import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useNavTrap } from '../hooks/useNavTrap';
import {
  canAckRoleReveal,
  canActAsMaharajVeto,
  canActAsSenapati,
  canCastVote,
  canDiscardMaharajTile,
  canDoneDiscussing,
  canExecPower,
  canNominate,
  isDiscussionReadyUpPhase,
  isGameWritable,
  payloadForPending,
  playerHasPendingAction,
} from '../lib/gameplay-enablement';
import { useGameSocket } from '../socket/SocketProvider';
import {
  useGameStore,
  type PendingSelection,
} from '../store/gameStore';
import { BoardChrome } from './game/BoardChrome';
import {
  DiscussionPanel,
  ExecutivePanel,
  FrozenPanel,
  LegislationMaharajPanel,
  LegislationSenapatiPanel,
  GameOverPanel,
  NominationPanel,
  RoleRevealPanel,
  VotingPanel,
} from './game/PhasePanels';

const ANIMATION_BLOCKS_ACTIONS = false as const;

/**
 * Board-first gameplay UI. Mirrors WirePlayerView only — never invents
 * legality, term limits, or win conditions.
 */
export function GameScreen() {
  const socket = useGameSocket();
  const roomId = useGameStore((s) => s.roomId);
  const roomCode = useGameStore((s) => s.roomCode);
  const view = useGameStore((s) => s.view);
  const playerId = useGameStore((s) => s.playerId);
  const lastError = useGameStore((s) => s.lastError);
  const readOnly = useGameStore((s) => s.readOnly);
  const roomFrozen = useGameStore((s) => s.roomFrozen);
  const pending = useGameStore((s) => s.pendingSelection);
  const animationEpoch = useGameStore((s) => s.animationEpoch);
  const setPendingSelection = useGameStore((s) => s.setPendingSelection);

  const inActiveGame =
    Boolean(roomId) &&
    Boolean(view) &&
    view?.phase.kind !== 'LOBBY' &&
    view?.phase.kind !== 'GAME_OVER';

  useNavTrap(Boolean(inActiveGame));

  if (!roomId) {
    return <Navigate to="/" replace />;
  }

  if (view?.phase.kind === 'LOBBY') {
    return <Navigate to="/lobby" replace />;
  }

  if (!view) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
        <p className="font-body text-sm text-mist-300">Syncing game state…</p>
        {lastError ? (
          <p className="mt-4 font-body text-sm text-clay-400" role="alert">
            {lastError}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => socket.leaveRoom()}
          className="mt-8 min-h-11 rounded-md border border-mist-300/25 px-4 py-3 font-body text-sm font-semibold text-mist-200 transition hover:border-mist-300/50"
        >
          Exit to home
        </button>
      </main>
    );
  }

  const writable = isGameWritable(view, {
    readOnly,
    roomFrozen: roomFrozen !== null,
  });

  const onSelect = (draft: Omit<PendingSelection, 'phaseKind' | 'stateVersion'>) => {
    setPendingSelection({
      phaseKind: view.phase.kind,
      stateVersion: view.stateVersion,
      ...draft,
    });
  };

  const onSubmit = (immediate?: Omit<PendingSelection, 'phaseKind' | 'stateVersion'>) => {
    const latest = useGameStore.getState().view;
    if (!latest) return;
    const selection = immediate
      ? {
          phaseKind: latest.phase.kind,
          stateVersion: latest.stateVersion,
          ...immediate,
        }
      : useGameStore.getState().pendingSelection;
    if (!selection) return;
    if (
      selection.phaseKind !== latest.phase.kind ||
      selection.stateVersion !== latest.stateVersion
    ) {
      useGameStore.getState().setLastError('State moved — tap again');
      useGameStore.getState().setPendingSelection(null);
      return;
    }
    const payload = payloadForPending(selection.kind, selection.value, latest);
    if (!payload) {
      useGameStore.getState().setLastError('That action is not available right now');
      return;
    }
    void ANIMATION_BLOCKS_ACTIONS;
    useGameStore.getState().setLastError(null);
    socket.sendGameAction(payload);
  };

  const panelProps = {
    view,
    playerId,
    writable,
    pending,
    onSelect,
    onSubmit,
    animationBlocksActions: ANIMATION_BLOCKS_ACTIONS,
  };

  const fullBleed =
    view.phase.kind === 'ROLE_REVEAL' || view.phase.kind === 'GAME_OVER';

  let body: ReactNode;
  switch (view.phase.kind) {
    case 'ROLE_REVEAL':
      body = <RoleRevealPanel {...panelProps} />;
      break;
    case 'ELECTION_NOMINATION':
      body = <NominationPanel {...panelProps} />;
      break;
    case 'DISCUSSION_PRE_VOTE':
      body = <DiscussionPanel {...panelProps} />;
      break;
    case 'ELECTION_VOTING':
      body =
        view.votesRevealed || view.phase.votesRevealed ? (
          <DiscussionPanel {...panelProps} />
        ) : (
          <VotingPanel {...panelProps} />
        );
      break;
    case 'LEGISLATION_MAHARAJ':
      body = <LegislationMaharajPanel {...panelProps} />;
      break;
    case 'LEGISLATION_SENAPATI':
      body = <LegislationSenapatiPanel {...panelProps} />;
      break;
    case 'DECREE_CEREMONY':
      body = <DiscussionPanel {...panelProps} />;
      break;
    case 'EXECUTIVE_ACTION':
      body = <ExecutivePanel {...panelProps} />;
      break;
    case 'GAME_OVER':
      body = <GameOverPanel view={view} onPlayAgain={() => socket.playAgain()} />;
      break;
    case 'ROOM_FROZEN':
    case 'ROOM_CORRUPTED':
      body = (
        <FrozenPanel
          mode={view.phase.kind === 'ROOM_CORRUPTED' ? 'CORRUPTED' : 'FROZEN'}
        />
      );
      break;
    case 'KURUKSHETRA_ANARCHY':
      body = null;
      break;
    default:
      body = null;
  }

  if (roomFrozen && view.phase.kind !== 'ROOM_FROZEN' && view.phase.kind !== 'ROOM_CORRUPTED') {
    body = <FrozenPanel mode={roomFrozen.mode} />;
  }

  const seatId = playerId ?? view.viewerId;
  const livingMe = view.players.find((p) => p.id === seatId);
  const showTablePrompt =
    body !== null &&
    (view.phase.kind === 'ROOM_FROZEN' ||
      view.phase.kind === 'ROOM_CORRUPTED' ||
      view.phase.kind === 'ELECTION_NOMINATION' ||
      (isDiscussionReadyUpPhase(view) && !view.isSpectator && Boolean(livingMe?.isAlive)) ||
      canAckRoleReveal(view, playerId) ||
      canDoneDiscussing(view, playerId) ||
      canNominate(view, playerId) ||
      canCastVote(view, playerId) ||
      canDiscardMaharajTile(view, playerId) ||
      canActAsSenapati(view, playerId) ||
      canActAsMaharajVeto(view, playerId) ||
      canExecPower(view, playerId) ||
      roomFrozen !== null);

  const exitButton = (
    <button
      type="button"
      onClick={() => socket.leaveRoom()}
      className="min-h-11 shrink-0 self-start rounded-md border border-mist-300/25 px-4 py-2.5 font-body text-sm font-semibold text-mist-200 transition hover:border-mist-300/50"
    >
      Exit to home
    </button>
  );

  if (fullBleed) {
    return (
      <main
        className="fixed inset-0 mx-auto flex w-full max-w-4xl flex-col overflow-hidden px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6"
        data-testid="game-viewport"
      >
        <div
          key={animationEpoch}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          data-testid="phase-panel"
          aria-label="Your action"
        >
          {body}
        </div>
        {exitButton}
        {lastError ? (
          <p className="mt-2 shrink-0 font-body text-sm text-clay-400" role="alert">
            {lastError}
          </p>
        ) : null}
      </main>
    );
  }

  return (
    <main
      className="fixed inset-0 mx-auto flex w-full max-w-6xl flex-col overflow-hidden px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6"
      data-testid="game-viewport"
    >
      <BoardChrome
        view={view}
        roomCode={roomCode}
        animationEpoch={animationEpoch}
        playerId={playerId}
        showAfkCountdown={playerHasPendingAction(view, playerId)}
        prompt={
          showTablePrompt ? (
            <div key={view.phase.kind} data-testid="phase-panel">
              {body}
            </div>
          ) : null
        }
      />

      {readOnly ? (
        <p className="mt-2 shrink-0 font-body text-sm text-clay-400" role="status">
          Read-only connection — another tab is writable.
        </p>
      ) : null}

      {exitButton}

      {lastError ? (
        <p className="mt-2 shrink-0 font-body text-sm text-clay-400" role="alert">
          {lastError}
        </p>
      ) : null}
    </main>
  );
}
