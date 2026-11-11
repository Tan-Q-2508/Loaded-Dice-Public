import type { GameState } from './types.js';
import { livingPlayers, getPlayer } from './state-helpers.js';
import { assertDeckIntegrity } from './deck.js';
import { ROLE_COUNTS } from './types.js';

export function assertInvariants(state: GameState): void {
  if (state.phase.kind === 'ROOM_CORRUPTED' || state.phase.kind === 'ROOM_FROZEN') {
    return;
  }

  if (state.startPlayerCount > 0) {
    const roleCounts = ROLE_COUNTS[state.startPlayerCount];
    if (!roleCounts) {
      throw new Error(`Invalid start player count ${state.startPlayerCount}`);
    }
    const roles = state.players.map((p) => p.role).filter((r) => r !== null);
    const pandavas = roles.filter((r) => r === 'PANDAVA').length;
    const kauravas = roles.filter((r) => r === 'KAURAVA').length;
    const duryodhana = roles.filter((r) => r === 'DURYODHANA').length;
    if (pandavas > roleCounts.pandavas || kauravas > roleCounts.kauravas || duryodhana > 1) {
      throw new Error('Role assignment exceeds setup table limits');
    }
  }

  const alive = state.players.filter((p) => p.isAlive).length;
  const dead = state.players.filter((p) => !p.isAlive).length;
  if (alive + dead !== state.players.length) {
    throw new Error('alive + dead != total players');
  }

  if (state.decreeDeck.length < 0) {
    throw new Error('Negative decree deck size');
  }

  const integrity = assertDeckIntegrity(state);
  if (!integrity.ok && state.phase.kind !== 'LOBBY') {
    throw new Error(integrity.reason);
  }

  const phasesRequiringMaharaj = new Set([
    'ELECTION_NOMINATION',
    'DISCUSSION_PRE_VOTE',
    'ELECTION_VOTING',
    'LEGISLATION_MAHARAJ',
    'LEGISLATION_SENAPATI',
    'EXECUTIVE_ACTION',
    'DECREE_CEREMONY',
  ]);
  if (phasesRequiringMaharaj.has(state.phase.kind)) {
    const maharaj = getPlayer(state, state.maharajCandidateId);
    if (!maharaj?.isAlive) {
      throw new Error('Maharaj candidate must be alive');
    }
  }

  if (
    state.phase.kind === 'LEGISLATION_MAHARAJ' ||
    state.phase.kind === 'LEGISLATION_SENAPATI' ||
    state.phase.kind === 'EXECUTIVE_ACTION' ||
    (state.phase.kind === 'DECREE_CEREMONY' &&
      state.phase.followUp.kind === 'EXECUTIVE')
  ) {
    if (!state.currentGovernment) {
      throw new Error('Legislation/executive phases require seated government');
    }
    const m = getPlayer(state, state.currentGovernment.maharajId);
    const s = getPlayer(state, state.currentGovernment.senapatiId);
    if (!m?.isAlive || !s?.isAlive) {
      throw new Error('Seated government must be alive');
    }
  }

  if (state.phase.kind === 'ELECTION_VOTING') {
    const voteCount = Object.values(state.phase.votes).filter((v) => v !== undefined).length;
    if (voteCount > livingPlayers(state).length) {
      throw new Error('More votes than living players');
    }
  }

  const validPhases = new Set([
    'LOBBY',
    'ROLE_REVEAL',
    'ELECTION_NOMINATION',
    'DISCUSSION_PRE_VOTE',
    'ELECTION_VOTING',
    'KURUKSHETRA_ANARCHY',
    'LEGISLATION_MAHARAJ',
    'LEGISLATION_SENAPATI',
    'EXECUTIVE_ACTION',
    'DECREE_CEREMONY',
    'GAME_OVER',
    'ROOM_FROZEN',
    'ROOM_CORRUPTED',
  ]);
  if (!validPhases.has(state.phase.kind)) {
    throw new Error(`Invalid phase ${state.phase.kind}`);
  }
}
