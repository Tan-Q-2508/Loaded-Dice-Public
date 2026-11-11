import type { GameAction, GameState, VoteChoice } from './types.js';
import { livingPlayers, getPlayer, isVetoUnlocked } from './state-helpers.js';
import { isSenapatiEligible } from './term-limits.js';

const VOTE_CHOICES: readonly VoteChoice[] = ['HA', 'NAHI'];

/**
 * Authoritative legal-actions query for a single player.
 * Options are derived from the current phase and the same eligibility rules
 * `applyAction` enforces — policies must not reimplement legality.
 *
 * Already-submitted votes are excluded so clients cannot loop forever on
 * overwrite-capable vote actions (election and veto).
 */
export function getLegalActions(state: GameState, playerId: string): readonly GameAction[] {
  if (
    state.phase.kind === 'GAME_OVER' ||
    state.phase.kind === 'ROOM_FROZEN' ||
    state.phase.kind === 'ROOM_CORRUPTED' ||
    state.phase.kind === 'LOBBY' ||
    state.phase.kind === 'KURUKSHETRA_ANARCHY'
  ) {
    return [];
  }

  const player = getPlayer(state, playerId);
  if (!player) return [];

  switch (state.phase.kind) {
    case 'ROLE_REVEAL': {
      if (!state.phase.pendingAcks.includes(playerId)) return [];
      return [{ type: 'ACK_ROLE_REVEAL', playerId }];
    }

    case 'ELECTION_NOMINATION': {
      if (playerId !== state.maharajCandidateId) return [];
      const actions: GameAction[] = [];
      for (const nominee of livingPlayers(state)) {
        const eligibility = isSenapatiEligible(state, nominee.id);
        if (eligibility.eligible) {
          actions.push({
            type: 'NOMINATE_SENAPATI',
            maharajId: playerId,
            nomineeId: nominee.id,
          });
        }
      }
      return actions;
    }

    case 'DISCUSSION_PRE_VOTE': {
      if (!player.isAlive) return [];
      if (!state.phase.pendingDone.includes(playerId)) return [];
      return [{ type: 'DONE_DISCUSSING', playerId }];
    }

    case 'ELECTION_VOTING': {
      if (!player.isAlive) return [];
      if (state.phase.votesRevealed) {
        if (!state.phase.pendingDone.includes(playerId)) return [];
        return [{ type: 'DONE_DISCUSSING', playerId }];
      }
      if (state.phase.votes[playerId] !== undefined) return [];
      return VOTE_CHOICES.map((vote) => ({
        type: 'CAST_VOTE' as const,
        playerId,
        vote,
      }));
    }

    case 'DECREE_CEREMONY': {
      if (!player.isAlive) return [];
      if (!state.phase.pendingDone.includes(playerId)) return [];
      return [{ type: 'DONE_DISCUSSING', playerId }];
    }

    case 'LEGISLATION_MAHARAJ': {
      if (!state.currentGovernment || playerId !== state.currentGovernment.maharajId) {
        return [];
      }
      return state.phase.drawnTiles.map((tile) => ({
        type: 'DISCARD_MAHARAJ_TILE' as const,
        maharajId: playerId,
        tileId: tile.id,
      }));
    }

    case 'LEGISLATION_SENAPATI': {
      const gov = state.currentGovernment;
      if (!gov) return [];
      const actions: GameAction[] = [];
      const isSenapati = playerId === gov.senapatiId;
      const isMaharaj = playerId === gov.maharajId;

      if (state.phase.vetoProposed) {
        const alreadyVoted = state.phase.vetoVotes[playerId] !== undefined;
        if ((isSenapati || isMaharaj) && !alreadyVoted) {
          for (const vote of VOTE_CHOICES) {
            actions.push({ type: 'CAST_VETO_VOTE', playerId, vote });
          }
        }
        // Senapati may still enact instead of waiting out / after a rejected veto.
        if (isSenapati) {
          for (const tile of state.phase.heldTiles) {
            actions.push({
              type: 'DISCARD_SENAPATI_TILE',
              senapatiId: playerId,
              tileId: tile.id,
            });
          }
        }
        return actions;
      }

      if (isSenapati) {
        if (isVetoUnlocked(state)) {
          actions.push({ type: 'PROPOSE_VETO', senapatiId: playerId });
        }
        for (const tile of state.phase.heldTiles) {
          actions.push({
            type: 'DISCARD_SENAPATI_TILE',
            senapatiId: playerId,
            tileId: tile.id,
          });
        }
      }
      return actions;
    }

    case 'EXECUTIVE_ACTION': {
      if (!state.currentGovernment || playerId !== state.currentGovernment.maharajId) {
        return [];
      }
      const maharajId = playerId;
      switch (state.phase.power) {
        case 'DIVYA_DRISHTI': {
          return livingPlayers(state)
            .filter(
              (p) =>
                p.id !== maharajId && !state.investigatedPlayerIds.includes(p.id),
            )
            .map((p) => ({
              type: 'EXEC_DIVYA_DRISHTI' as const,
              maharajId,
              targetId: p.id,
            }));
        }
        case 'RAJYA_SABHA_SUMMONS': {
          return livingPlayers(state)
            .filter((p) => p.id !== maharajId)
            .map((p) => ({
              type: 'EXEC_RAJYA_SABHA_SUMMONS' as const,
              maharajId,
              targetId: p.id,
            }));
        }
        case 'AKASHVANI': {
          return [{ type: 'EXEC_AKASHVANI_ACK', maharajId }];
        }
        case 'VANVAS': {
          return livingPlayers(state)
            .filter((p) => p.id !== maharajId)
            .map((p) => ({
              type: 'EXEC_VANVAS' as const,
              maharajId,
              targetId: p.id,
            }));
        }
        default: {
          const _exhaustive: never = state.phase.power;
          void _exhaustive;
          return [];
        }
      }
    }

    default: {
      const _exhaustive: never = state.phase;
      void _exhaustive;
      return [];
    }
  }
}

/**
 * System / driver-only actions that are legal in the current phase.
 * Used by the simulation harness for timeout and default-vote paths.
 */
export function getSystemLegalActions(state: GameState): readonly GameAction[] {
  switch (state.phase.kind) {
    case 'ROLE_REVEAL':
      return [{ type: 'ROLE_REVEAL_TIMEOUT' }];
    case 'DISCUSSION_PRE_VOTE':
      return [{ type: 'DISCUSSION_PRE_VOTE_TIMEOUT' }];
    case 'ELECTION_VOTING': {
      if (state.phase.votesRevealed) {
        return [{ type: 'RESOLVE_ELECTION' }];
      }
      const votes = state.phase.votes;
      const missing = livingPlayers(state).some((p) => votes[p.id] === undefined);
      return missing ? [{ type: 'CAST_DEFAULT_VOTES' }] : [];
    }
    case 'DECREE_CEREMONY':
      return [{ type: 'ADVANCE_AFTER_DECREE' }];
    default:
      return [];
  }
}

/**
 * All players who currently have at least one legal action, in seat order.
 */
export function playersWithLegalActions(state: GameState): readonly string[] {
  return [...state.players]
    .sort((a, b) => a.seatOrder - b.seatOrder)
    .filter((p) => getLegalActions(state, p.id).length > 0)
    .map((p) => p.id);
}
