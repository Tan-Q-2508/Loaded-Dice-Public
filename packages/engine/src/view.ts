import type { GameState, PlayerView, PublicPlayerView, VoteChoice } from './types.js';
import { teamForRole } from './types.js';
import { knownDuryodhanaIdForPlayer, knownKauravasForPlayer } from './setup.js';
import { isVetoUnlocked } from './state-helpers.js';

export function getPlayerView(state: GameState, playerId: string): PlayerView {
  const viewer = state.players.find((p) => p.id === playerId);
  const isSpectator = viewer ? !viewer.isAlive : true;
  const gameOver = state.phase.kind === 'GAME_OVER';

  const publicPlayers: PublicPlayerView[] = state.players.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    seatOrder: p.seatOrder,
    isAlive: p.isAlive,
    revealedRole: gameOver ? p.role : null,
  }));

  let drawnTilesForMaharaj: typeof state.decreeDeck = [];
  let heldTiles: typeof state.decreeDeck = [];
  let peekedTiles: typeof state.decreeDeck = [];
  let votes: PlayerView['votes'] = null;
  let votesRevealed = false;

  if (state.phase.kind === 'LEGISLATION_MAHARAJ' && state.currentGovernment?.maharajId === playerId) {
    drawnTilesForMaharaj = state.phase.drawnTiles;
  }

  if (state.phase.kind === 'LEGISLATION_SENAPATI' && state.currentGovernment?.senapatiId === playerId) {
    heldTiles = state.phase.heldTiles;
  }

  if (state.phase.kind === 'EXECUTIVE_ACTION' && state.phase.power === 'AKASHVANI') {
    if (state.currentGovernment?.maharajId === playerId) {
      peekedTiles = state.decreeDeck.slice(0, 3);
      // #region agent log
      fetch('http://127.0.0.1:7361/ingest/3fd40a7f-41cf-45a6-ac18-e83e0fd4bfa6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fd802b'},body:JSON.stringify({sessionId:'fd802b',hypothesisId:'H5',location:'view.ts:akashvaniPeek',message:'Akashvani peek resolved',data:{peekCount:peekedTiles.length,deckCount:state.decreeDeck.length,ashCount:state.ashPile.length,peekIds:peekedTiles.map((t)=>t.id)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    }
  }

  if (state.phase.kind === 'ELECTION_VOTING') {
    const phaseVotes: Record<string, VoteChoice | undefined> = { ...state.phase.votes };
    votesRevealed = state.phase.votesRevealed;
    if (!votesRevealed) {
      for (const key of Object.keys(phaseVotes)) {
        if (key !== playerId) {
          phaseVotes[key] = undefined;
        }
      }
    }
    votes = phaseVotes;
  }

  const ownRole = viewer?.role ?? null;
  const ownTeam = ownRole ? teamForRole(ownRole) : null;

  return {
    roomId: state.roomId,
    viewerId: playerId,
    phase: sanitizePhaseForViewer(state, playerId),
    players: publicPlayers,
    hostPlayerId: state.hostPlayerId,
    rebalanceEnabled: state.rebalanceEnabled,
    ownRole,
    ownTeam,
    knownKauravas: isSpectator ? [] : knownKauravasForPlayer(state, playerId),
    knownDuryodhanaId: isSpectator ? null : knownDuryodhanaIdForPlayer(state, playerId),
    maharajCandidateId: state.maharajCandidateId,
    senapatiCandidateId: state.senapatiCandidateId,
    currentGovernment: state.currentGovernment,
    lastElectedGovernment: state.lastElectedGovernment,
    enactedDharma: state.enactedDharma,
    enactedAdharma: state.enactedAdharma,
    electionTracker: state.electionTracker,
    vetoUnlocked: isVetoUnlocked(state),
    heldTiles,
    drawnTilesForMaharaj,
    peekedTiles,
    ownInvestigations: state.privateInvestigations[playerId] ?? [],
    votes,
    votesRevealed,
    startPlayerCount: state.startPlayerCount,
    lastEnactedDecree:
      state.phase.kind === 'DECREE_CEREMONY' ? state.phase.tileType : null,
    decreeDeckCount: state.decreeDeck.length,
    ashPileCount: state.ashPile.length,
    lastExiledPlayerId: state.lastExiledPlayerId,
    winner: state.phase.kind === 'GAME_OVER' ? state.phase.winner : null,
    winReason: state.phase.kind === 'GAME_OVER' ? state.phase.reason : null,
    isSpectator,
  };
}

function sanitizePhaseForViewer(state: GameState, playerId: string): GameState['phase'] {
  switch (state.phase.kind) {
    case 'LEGISLATION_MAHARAJ':
      if (state.currentGovernment?.maharajId === playerId) {
        return state.phase;
      }
      return { kind: 'LEGISLATION_MAHARAJ', drawnTiles: [] };
    case 'LEGISLATION_SENAPATI':
      if (state.currentGovernment?.senapatiId === playerId) {
        return state.phase;
      }
      return {
        kind: 'LEGISLATION_SENAPATI',
        heldTiles: [],
        vetoProposed: state.phase.vetoProposed,
        vetoVotes: {},
      };
    case 'EXECUTIVE_ACTION':
      if (state.phase.power === 'AKASHVANI' && state.currentGovernment?.maharajId !== playerId) {
        return { kind: 'EXECUTIVE_ACTION', power: state.phase.power };
      }
      return state.phase;
    default:
      return state.phase;
  }
}

export function getSpectatorView(state: GameState, spectatorId: string): PlayerView {
  const view = getPlayerView(state, spectatorId);
  return {
    ...view,
    ownRole: null,
    ownTeam: null,
    knownKauravas: [],
    knownDuryodhanaId: null,
    heldTiles: [],
    drawnTilesForMaharaj: [],
    peekedTiles: [],
    ownInvestigations: [],
    isSpectator: true,
  };
}
