import {
  getPlayerView,
  getSpectatorView,
  type GameState,
  type Phase,
  type PlayerView,
} from '@shaatir-shakuni/engine';
import { PROTOCOL_VERSION } from './protocol.js';
import type { WirePlayerView } from './schemas/outbound.js';

/** EC-30 — authoritative timer display fields attached at emit time. */
export type WireTimerFields = {
  readonly afkDeadlineMs: number | null;
  readonly serverNowMs: number;
  readonly deferredAfkPlayerIds?: readonly string[];
};

export const EMPTY_WIRE_TIMERS: WireTimerFields = {
  afkDeadlineMs: null,
  serverNowMs: 0,
  deferredAfkPlayerIds: [],
};

function phaseToWire(phase: Phase): WirePlayerView['phase'] {
  switch (phase.kind) {
    case 'LOBBY':
      return { kind: 'LOBBY' };
    case 'ROLE_REVEAL':
      return { kind: 'ROLE_REVEAL', pendingAcks: [...phase.pendingAcks] };
    case 'ELECTION_NOMINATION':
      return { kind: 'ELECTION_NOMINATION' };
    case 'DISCUSSION_PRE_VOTE':
      return { kind: 'DISCUSSION_PRE_VOTE', pendingDone: [...phase.pendingDone] };
    case 'ELECTION_VOTING':
      return {
        kind: 'ELECTION_VOTING',
        votes: { ...phase.votes },
        votesRevealed: phase.votesRevealed,
        pendingDone: [...phase.pendingDone],
      };
    case 'KURUKSHETRA_ANARCHY':
      return { kind: 'KURUKSHETRA_ANARCHY' };
    case 'LEGISLATION_MAHARAJ':
      return { kind: 'LEGISLATION_MAHARAJ', drawnTiles: [...phase.drawnTiles] };
    case 'LEGISLATION_SENAPATI':
      return {
        kind: 'LEGISLATION_SENAPATI',
        heldTiles: [...phase.heldTiles],
        vetoProposed: phase.vetoProposed,
        vetoVotes: { ...phase.vetoVotes },
      };
    case 'EXECUTIVE_ACTION':
      return {
        kind: 'EXECUTIVE_ACTION',
        power: phase.power,
        ...(phase.peekedTiles ? { peekedTiles: [...phase.peekedTiles] } : {}),
      };
    case 'DECREE_CEREMONY':
      return {
        kind: 'DECREE_CEREMONY',
        tileType: phase.tileType,
        tileId: phase.tileId,
        followUp: phase.followUp,
        pendingDone: [...phase.pendingDone],
      };
    case 'GAME_OVER':
      return { kind: 'GAME_OVER', winner: phase.winner, reason: phase.reason };
    case 'ROOM_FROZEN':
      return { kind: 'ROOM_FROZEN', reason: phase.reason };
    case 'ROOM_CORRUPTED':
      return { kind: 'ROOM_CORRUPTED', reason: phase.reason };
  }
}

/**
 * Last gate before emit: convert an engine PlayerView into the wire schema,
 * attaching authoritative stateVersion. Does not re-derive secrets — callers
 * must pass a view from getPlayerView / getSpectatorView.
 */
export function toWirePlayerView(
  view: PlayerView,
  stateVersion: number,
  timers: WireTimerFields = EMPTY_WIRE_TIMERS,
): WirePlayerView {
  return {
    roomId: view.roomId,
    viewerId: view.viewerId,
    stateVersion,
    protocolVersion: PROTOCOL_VERSION,
    phase: phaseToWire(view.phase),
    players: view.players.map((p) => ({ ...p })),
    hostPlayerId: view.hostPlayerId,
    rebalanceEnabled: view.rebalanceEnabled,
    ownRole: view.ownRole,
    ownTeam: view.ownTeam,
    knownKauravas: [...view.knownKauravas],
    knownDuryodhanaId: view.knownDuryodhanaId,
    maharajCandidateId: view.maharajCandidateId,
    senapatiCandidateId: view.senapatiCandidateId,
    currentGovernment: view.currentGovernment
      ? { ...view.currentGovernment }
      : null,
    lastElectedGovernment: view.lastElectedGovernment
      ? { ...view.lastElectedGovernment }
      : null,
    enactedDharma: view.enactedDharma,
    enactedAdharma: view.enactedAdharma,
    electionTracker: view.electionTracker,
    vetoUnlocked: view.vetoUnlocked,
    heldTiles: [...view.heldTiles],
    drawnTilesForMaharaj: [...view.drawnTilesForMaharaj],
    peekedTiles: [...view.peekedTiles],
    ownInvestigations: view.ownInvestigations.map((i) => ({ ...i })),
    votes: view.votes ? { ...view.votes } : null,
    votesRevealed: view.votesRevealed,
    startPlayerCount: view.startPlayerCount,
    lastEnactedDecree: view.lastEnactedDecree,
    decreeDeckCount: view.decreeDeckCount,
    ashPileCount: view.ashPileCount,
    lastExiledPlayerId: view.lastExiledPlayerId,
    winner: view.winner,
    winReason: view.winReason,
    isSpectator: view.isSpectator,
    afkDeadlineMs: timers.afkDeadlineMs,
    serverNowMs: timers.serverNowMs,
    deferredAfkPlayerIds: [...(timers.deferredAfkPlayerIds ?? [])],
  };
}

/**
 * EC-15: build the authoritative sync payload for a player (or spectator).
 * Server state always wins — there is no client-merge helper.
 */
export function buildStateSyncPayload(
  state: GameState,
  playerId: string,
  options?: {
    readonly asSpectator?: boolean;
    readonly timers?: WireTimerFields;
  },
): { readonly view: WirePlayerView } {
  const engineView = options?.asSpectator
    ? getSpectatorView(state, playerId)
    : getPlayerView(state, playerId);
  return {
    view: toWirePlayerView(
      engineView,
      state.stateVersion,
      options?.timers ?? EMPTY_WIRE_TIMERS,
    ),
  };
}

/** Collect tile ids present anywhere in a wire view (for leak assertions). */
export function collectWireTileIds(view: WirePlayerView): readonly string[] {
  const ids: string[] = [];
  const push = (tiles: readonly { id: string }[]) => {
    for (const t of tiles) ids.push(t.id);
  };
  push(view.heldTiles);
  push(view.drawnTilesForMaharaj);
  push(view.peekedTiles);
  if (view.phase.drawnTiles) push(view.phase.drawnTiles);
  if (view.phase.heldTiles) push(view.phase.heldTiles);
  if (view.phase.peekedTiles) push(view.phase.peekedTiles);
  return ids;
}
