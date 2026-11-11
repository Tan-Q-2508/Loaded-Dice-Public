import type {
  GameState,
  GameAction,
  GameEvent,
  EngineDeps,
  VoteChoice,
  RajaagnaPower,
} from './types.js';
import {
  reject,
  bumpVersion,
  livingPlayers,
  getPlayer,
  advanceMaharajPlacard,
  withPhase,
  isVetoUnlocked,
  nextLivingPlayerId,
} from './state-helpers.js';
import { startGame } from './setup.js';
import { createRng } from './rng.js';
import { isSenapatiEligible } from './term-limits.js';
import {
  checkDecreeWin,
  checkDuryodhanaSenapatiWin,
  checkVanvasWin,
  applyGameOver,
} from './win-conditions.js';
import { drawTiles, checkDeckOrCorrupt, reshuffleIfNeeded } from './deck.js';
import { teamForRole } from './types.js';
import { assertInvariants } from './invariants.js';
import { deepFreeze } from './deep-freeze.js';

function finalize(
  state: GameState,
  events: GameEvent[],
  deps: EngineDeps,
): { state: GameState; events: GameEvent[] } {
  const corruptResult = checkDeckOrCorrupt(state);
  if (corruptResult) return corruptResult;
  if (deps.enforceImmutability !== false) {
    try {
      assertInvariants(state);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Invariant violation';
      return {
        state: { ...state, phase: { kind: 'ROOM_FROZEN', reason }, stateVersion: state.stateVersion + 1 },
        events: [...events, { type: 'ROOM_FAILURE', mode: 'ROOM_FROZEN', reason }],
      };
    }
  }
  const frozen = deps.enforceImmutability !== false ? deepFreeze(state) : state;
  return { state: frozen, events };
}

function countYesVotes(
  state: GameState,
  votes: Readonly<Record<string, VoteChoice | undefined>>,
): { yes: number; no: number; total: number } {
  const living = livingPlayers(state);
  let yes = 0;
  let no = 0;
  for (const p of living) {
    const v = votes[p.id];
    if (v === 'HA') yes += 1;
    else if (v === 'NAHI') no += 1;
  }
  return { yes, no, total: living.length };
}

function enactDecree(
  state: GameState,
  tileType: 'DHARMA' | 'ADHARMA',
  tileId: string,
  events: GameEvent[],
  skipPower: boolean,
  deps: EngineDeps,
): { state: GameState; events: GameEvent[] } {
  const enactedDharma = state.enactedDharma + (tileType === 'DHARMA' ? 1 : 0);
  const enactedAdharma = state.enactedAdharma + (tileType === 'ADHARMA' ? 1 : 0);

  // Keep currentGovernment until we leave legislation/executive — clearing it
  // before EXECUTIVE_ACTION freezes the room (EC-122).
  const next: GameState = {
    ...state,
    enactedDharma,
    enactedAdharma,
    electionTracker: 0,
  };

  const enactEvents: GameEvent[] = [
    ...events,
    {
      type: 'DECREE_ENACTED',
      tileId,
      tileType,
      dharmaCount: enactedDharma,
      adharmaCount: enactedAdharma,
    },
  ];

  const decreeWin = checkDecreeWin({ ...next, enactedDharma, enactedAdharma });
  if (decreeWin) {
    return applyGameOver(
      { ...next, currentGovernment: null },
      decreeWin.winner,
      decreeWin.reason,
      enactEvents,
    );
  }

  let followUp:
    | { readonly kind: 'NOMINATION' }
    | { readonly kind: 'EXECUTIVE'; readonly power: RajaagnaPower } = {
    kind: 'NOMINATION',
  };
  const ceremonyEvents: GameEvent[] = [...enactEvents];

  if (!skipPower && tileType === 'ADHARMA') {
    const power = deps.powerTable.getPower(state.startPlayerCount, enactedAdharma);
    if (power) {
      followUp = { kind: 'EXECUTIVE', power };
      ceremonyEvents.push({ type: 'POWER_GRANTED', power });
    }
  }

  const ceremonyState: GameState = {
    ...next,
    // Keep government seated when a Rajaagna power will follow (EC-122).
    currentGovernment:
      followUp.kind === 'EXECUTIVE' ? next.currentGovernment : null,
    phase: {
      kind: 'DECREE_CEREMONY',
      tileType,
      tileId,
      followUp,
      pendingDone: livingPlayers(next).map((p) => p.id),
    },
    stateVersion: next.stateVersion + 1,
  };

  return finalize(
    ceremonyState,
    [
      ...ceremonyEvents,
      { type: 'PHASE_CHANGED', from: state.phase.kind, to: 'DECREE_CEREMONY' },
    ],
    deps,
  );
}

/** Public reveal only — table holds before RESOLVE_ELECTION. */
function revealVoting(state: GameState, events: GameEvent[]) {
  if (state.phase.kind !== 'ELECTION_VOTING') {
    return reject(state, 'RESOLVE', 'Not in voting');
  }

  const living = livingPlayers(state);
  const votes: Record<string, VoteChoice> = {};
  for (const p of living) {
    const v = state.phase.votes[p.id];
    if (v) votes[p.id] = v;
  }

  const revealEvents: GameEvent[] = [...events, { type: 'VOTES_REVEALED', votes }];
  const next = bumpVersion(
    {
      ...state,
      phase: {
        ...state.phase,
        votesRevealed: true,
        pendingDone: living.map((p) => p.id),
      },
    },
    revealEvents,
  ).state;
  return { state: next, events: revealEvents };
}

function enterElectionVoting(
  state: GameState,
  deps: EngineDeps,
): { state: GameState; events: GameEvent[] } {
  const from = state.phase.kind;
  const voting: GameState = {
    ...state,
    phase: {
      kind: 'ELECTION_VOTING',
      votes: {},
      votesRevealed: false,
      pendingDone: [],
    },
    stateVersion: state.stateVersion + 1,
  };
  return finalize(
    voting,
    [{ type: 'PHASE_CHANGED', from, to: 'ELECTION_VOTING' }],
    deps,
  );
}

function applyDoneDiscussing(
  state: GameState,
  playerId: string,
  deps: EngineDeps,
): { state: GameState; events: GameEvent[] } {
  const player = getPlayer(state, playerId);
  if (!player?.isAlive) return reject(state, 'DONE_DISCUSSING', 'Dead players cannot ready-up');

  // DECISIONS 2026-08-09: DONE_DISCUSSING is idempotent. Duplicate ready-ups and
  // late arrivals after the hold already advanced must succeed as no-ops so
  // concurrent seats (and double-clicks) do not surface ENGINE_REJECTED noise.
  const idempotentNoop = () => finalize(bumpVersion(state, []).state, [], deps);

  if (state.phase.kind === 'DISCUSSION_PRE_VOTE') {
    if (!state.phase.pendingDone.includes(playerId)) {
      return idempotentNoop();
    }
    const pending = state.phase.pendingDone.filter((id) => id !== playerId);
    if (pending.length > 0) {
      return finalize(
        bumpVersion(
          { ...state, phase: { ...state.phase, pendingDone: pending } },
          [],
        ).state,
        [],
        deps,
      );
    }
    return enterElectionVoting(state, deps);
  }

  if (state.phase.kind === 'ELECTION_VOTING' && state.phase.votesRevealed) {
    if (!state.phase.pendingDone.includes(playerId)) {
      return idempotentNoop();
    }
    const pending = state.phase.pendingDone.filter((id) => id !== playerId);
    const next = bumpVersion(
      { ...state, phase: { ...state.phase, pendingDone: pending } },
      [],
    ).state;
    if (pending.length > 0) {
      return finalize(next, [], deps);
    }
    return resolveElectionAfterReveal(next, [], deps);
  }

  if (state.phase.kind === 'DECREE_CEREMONY') {
    if (!state.phase.pendingDone.includes(playerId)) {
      return idempotentNoop();
    }
    const pending = state.phase.pendingDone.filter((id) => id !== playerId);
    const next = bumpVersion(
      { ...state, phase: { ...state.phase, pendingDone: pending } },
      [],
    ).state;
    if (pending.length > 0) {
      return finalize(next, [], deps);
    }
    return advanceAfterDecreeCeremony(next, deps);
  }

  return idempotentNoop();
}

/** After vote-reveal ceremony — accept/reject government / anarchy / win. */
function resolveElectionAfterReveal(
  state: GameState,
  events: GameEvent[],
  deps: EngineDeps,
) {
  if (state.phase.kind !== 'ELECTION_VOTING') {
    return reject(state, 'RESOLVE_ELECTION', 'Not in voting');
  }
  if (!state.phase.votesRevealed) {
    return reject(state, 'RESOLVE_ELECTION', 'Votes not yet revealed');
  }

  const living = livingPlayers(state);
  const votes: Record<string, VoteChoice> = {};
  for (const p of living) {
    const v = state.phase.votes[p.id];
    if (v) votes[p.id] = v;
  }

  const { yes, total } = countYesVotes(state, votes);
  const majority = yes > total / 2;
  let next = state;

  if (!majority) {
    const tracker = next.electionTracker + 1;
    const rejectEvents: GameEvent[] = [
      ...events,
      { type: 'GOVERNMENT_REJECTED', electionTracker: tracker },
    ];

    if (tracker >= 3) {
      const anarchyState: GameState = {
        ...next,
        electionTracker: tracker,
        phase: { kind: 'KURUKSHETRA_ANARCHY' },
        stateVersion: next.stateVersion + 1,
      };
      return handleAnarchy(anarchyState, rejectEvents, deps);
    }

    next = returnToNomination({ ...next, electionTracker: tracker });
    const nom: GameState = {
      ...next,
      stateVersion: next.stateVersion + 1,
    };
    return finalize(
      nom,
      [
        ...rejectEvents,
        { type: 'PHASE_CHANGED', from: 'ELECTION_VOTING', to: 'ELECTION_NOMINATION' },
      ],
      deps,
    );
  }

  const senapatiId = next.senapatiCandidateId;
  if (!senapatiId) return reject(state, 'RESOLVE_ELECTION', 'No senapati candidate');

  const duryodhanaWin = checkDuryodhanaSenapatiWin(next, senapatiId);
  if (duryodhanaWin) {
    // #region agent log
    fetch('http://127.0.0.1:7361/ingest/3fd40a7f-41cf-45a6-ac18-e83e0fd4bfa6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fd802b'},body:JSON.stringify({sessionId:'fd802b',hypothesisId:'H6',location:'applyAction.ts:duryodhanaSenapatiWin',message:'Duryodhana Senapati win triggered',data:{senapatiId,enactedAdharma:next.enactedAdharma,winner:duryodhanaWin.winner,reason:duryodhanaWin.reason},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const over = applyGameOver(next, duryodhanaWin.winner, duryodhanaWin.reason, [
      ...events,
      { type: 'GOVERNMENT_ACCEPTED', maharajId: next.maharajCandidateId, senapatiId },
    ]);
    return finalize(over.state, over.events, deps);
  }

  const government = { maharajId: next.maharajCandidateId, senapatiId };
  const legState: GameState = {
    ...next,
    lastElectedGovernment: government,
    currentGovernment: government,
    phase: { kind: 'LEGISLATION_MAHARAJ', drawnTiles: [] },
    stateVersion: next.stateVersion + 1,
  };

  const draw = drawTiles(legState, 3, deps.rng.shuffle.bind(deps.rng));
  if ('error' in draw) {
    return finalize(
      { ...legState, phase: { kind: 'ROOM_CORRUPTED', reason: draw.error } },
      [
        ...events,
        { type: 'GOVERNMENT_ACCEPTED', maharajId: government.maharajId, senapatiId },
      ],
      deps,
    );
  }

  const withTiles: GameState = {
    ...draw.state,
    phase: { kind: 'LEGISLATION_MAHARAJ', drawnTiles: draw.drawn },
  };

  return finalize(
    withTiles,
    [
      ...events,
      { type: 'GOVERNMENT_ACCEPTED', maharajId: government.maharajId, senapatiId },
      ...draw.events,
      { type: 'PHASE_CHANGED', from: 'ELECTION_VOTING', to: 'LEGISLATION_MAHARAJ' },
    ],
    deps,
  );
}

function advanceAfterDecreeCeremony(
  state: GameState,
  deps: EngineDeps,
): { state: GameState; events: GameEvent[] } {
  if (state.phase.kind !== 'DECREE_CEREMONY') {
    return reject(state, 'ADVANCE_AFTER_DECREE', 'Not in decree ceremony');
  }

  const followUp = state.phase.followUp;
  if (followUp.kind === 'EXECUTIVE') {
    let execBase = state;
    const execEvents: GameEvent[] = [];
    if (followUp.power === 'AKASHVANI') {
      const refill = reshuffleIfNeeded(
        execBase,
        3,
        deps.rng.shuffle.bind(deps.rng),
      );
      execBase = refill.state;
      execEvents.push(...refill.events);
    }
    const execState: GameState = {
      ...execBase,
      phase: { kind: 'EXECUTIVE_ACTION', power: followUp.power },
      stateVersion: state.stateVersion + 1,
    };
    return finalize(
      execState,
      [
        ...execEvents,
        { type: 'PHASE_CHANGED', from: 'DECREE_CEREMONY', to: 'EXECUTIVE_ACTION' },
      ],
      deps,
    );
  }

  const next = returnToNomination({ ...state, currentGovernment: null });
  const nomState: GameState = {
    ...next,
    stateVersion: next.stateVersion + 1,
  };
  return finalize(
    nomState,
    [{ type: 'PHASE_CHANGED', from: 'DECREE_CEREMONY', to: 'ELECTION_NOMINATION' }],
    deps,
  );
}

function handleAnarchy(state: GameState, events: GameEvent[], deps: EngineDeps) {
  const draw = drawTiles(state, 1, deps.rng.shuffle.bind(deps.rng));
  if ('error' in draw) {
    return finalize(
      { ...state, phase: { kind: 'ROOM_CORRUPTED', reason: draw.error } },
      events,
      deps,
    );
  }

  const tile = draw.drawn[0];
  if (!tile) {
    return finalize(
      { ...state, phase: { kind: 'ROOM_CORRUPTED', reason: 'No tile for anarchy' } },
      events,
      deps,
    );
  }

  const anarchyEvents: GameEvent[] = [
    ...events,
    ...draw.events,
    { type: 'KURUKSHETRA_ANARCHY', enactedTileId: tile.id, tileType: tile.type },
    { type: 'TERM_LIMITS_CLEARED' },
    { type: 'PHASE_CHANGED', from: state.phase.kind, to: 'KURUKSHETRA_ANARCHY' },
  ];

  let next: GameState = {
    ...draw.state,
    lastElectedGovernment: null,
    electionTracker: 0,
    currentGovernment: null,
    phase: { kind: 'KURUKSHETRA_ANARCHY' },
  };

  return enactDecree(next, tile.type, tile.id, anarchyEvents, true, deps);
}

function returnToNomination(state: GameState): GameState {
  if (state.summonsReturnAfterPlayerId) {
    // Field already holds the player *after* the Maharaj who called Summons
    // (set at EXEC_RAJYA_SABHA_SUMMONS). Use it directly — do not advance again (EC-65).
    const returnId = state.summonsReturnAfterPlayerId;
    return {
      ...state,
      maharajCandidateId: returnId,
      senapatiCandidateId: null,
      summonsReturnAfterPlayerId: null,
      phase: { kind: 'ELECTION_NOMINATION' },
    };
  }
  return {
    ...advanceMaharajPlacard(state),
    phase: { kind: 'ELECTION_NOMINATION' },
    senapatiCandidateId: null,
  };
}

function allVotesIn(state: GameState): boolean {
  if (state.phase.kind !== 'ELECTION_VOTING') return false;
  const phase = state.phase;
  return livingPlayers(state).every((p) => phase.votes[p.id] !== undefined);
}

export function applyAction(
  state: GameState,
  action: GameAction,
  deps: EngineDeps,
): { state: GameState; events: GameEvent[] } {
  if (state.phase.kind === 'GAME_OVER' || state.phase.kind === 'ROOM_FROZEN' || state.phase.kind === 'ROOM_CORRUPTED') {
    return reject(state, action.type, 'Game is terminal');
  }

  switch (action.type) {
    case 'START_GAME': {
      if (state.phase.kind !== 'LOBBY') return reject(state, action.type, 'Not in lobby');
      // Setup (roles, deck, first Maharaj) must follow action.seed — never deps.rng.
      // A mismatched injected RNG (lobby seed 0 → fallback 1) made every 5p table
      // deal host=Kaurava, seat 2=Duryodhana, and first Maharaj=Duryodhana.
      const result = startGame(
        state,
        action.playerIds,
        action.displayNames,
        action.hostPlayerId,
        action.rebalanceEnabled,
        action.seed,
        createRng(action.seed),
      );
      return finalize(result.state, result.events, deps);
    }

    case 'ACK_ROLE_REVEAL': {
      if (state.phase.kind !== 'ROLE_REVEAL') return reject(state, action.type, 'Not in role reveal');
      if (!state.phase.pendingAcks.includes(action.playerId)) {
        return reject(state, action.type, 'Player already acked or invalid');
      }
      const pending = state.phase.pendingAcks.filter((id) => id !== action.playerId);
      if (pending.length > 0) {
        return finalize(
          bumpVersion({ ...state, phase: { kind: 'ROLE_REVEAL', pendingAcks: pending } }, []).state,
          [],
          deps,
        );
      }
      return finalize(
        bumpVersion(
          { ...state, phase: { kind: 'ELECTION_NOMINATION' } },
          [{ type: 'PHASE_CHANGED', from: 'ROLE_REVEAL', to: 'ELECTION_NOMINATION' }],
        ).state,
        [{ type: 'PHASE_CHANGED', from: 'ROLE_REVEAL', to: 'ELECTION_NOMINATION' }],
        deps,
      );
    }

    case 'ROLE_REVEAL_TIMEOUT': {
      if (state.phase.kind !== 'ROLE_REVEAL') return reject(state, action.type, 'Not in role reveal');
      return finalize(
        bumpVersion(
          { ...state, phase: { kind: 'ELECTION_NOMINATION' } },
          [{ type: 'PHASE_CHANGED', from: 'ROLE_REVEAL', to: 'ELECTION_NOMINATION' }],
        ).state,
        [{ type: 'PHASE_CHANGED', from: 'ROLE_REVEAL', to: 'ELECTION_NOMINATION' }],
        deps,
      );
    }

    case 'NOMINATE_SENAPATI': {
      if (state.phase.kind !== 'ELECTION_NOMINATION') return reject(state, action.type, 'Not in nomination');
      if (action.maharajId !== state.maharajCandidateId) return reject(state, action.type, 'Not the Maharaj candidate');
      const eligibility = isSenapatiEligible(state, action.nomineeId);
      if (!eligibility.eligible) return reject(state, action.type, eligibility.reason);
      const discussion: GameState = {
        ...state,
        senapatiCandidateId: action.nomineeId,
        phase: {
          kind: 'DISCUSSION_PRE_VOTE',
          pendingDone: livingPlayers(state).map((p) => p.id),
        },
        stateVersion: state.stateVersion + 1,
      };
      return finalize(discussion, [
        { type: 'SENAPATI_NOMINATED', nomineeId: action.nomineeId },
        { type: 'PHASE_CHANGED', from: 'ELECTION_NOMINATION', to: 'DISCUSSION_PRE_VOTE' },
      ], deps);
    }

    case 'DONE_DISCUSSING': {
      return applyDoneDiscussing(state, action.playerId, deps);
    }

    case 'DISCUSSION_PRE_VOTE_TIMEOUT': {
      if (state.phase.kind !== 'DISCUSSION_PRE_VOTE') {
        return reject(state, action.type, 'Not in pre-vote discussion');
      }
      return enterElectionVoting(state, deps);
    }

    case 'CAST_VOTE': {
      if (state.phase.kind !== 'ELECTION_VOTING') return reject(state, action.type, 'Not in voting');
      if (state.phase.votesRevealed) return reject(state, action.type, 'Votes already revealed');
      const voter = getPlayer(state, action.playerId);
      if (!voter?.isAlive) return reject(state, action.type, 'Dead players cannot vote');
      const votes = { ...state.phase.votes, [action.playerId]: action.vote };
      const next: GameState = {
        ...state,
        phase: { ...state.phase, votes },
        stateVersion: state.stateVersion + 1,
      };
      const events: GameEvent[] = [{ type: 'VOTE_CAST', playerId: action.playerId, vote: action.vote }];
      if (allVotesIn(next)) {
        const revealed = revealVoting(next, events);
        if (revealed.events.some((e) => e.type === 'ACTION_REJECTED')) {
          return revealed;
        }
        return finalize(revealed.state, revealed.events, deps);
      }
      return finalize(next, events, deps);
    }

    case 'CAST_DEFAULT_VOTES': {
      if (state.phase.kind !== 'ELECTION_VOTING') return reject(state, action.type, 'Not in voting');
      if (state.phase.votesRevealed) return reject(state, action.type, 'Votes already revealed');
      const votingPhase = state.phase;
      const votes: Record<string, VoteChoice | undefined> = { ...votingPhase.votes };
      for (const p of livingPlayers(state)) {
        if (votes[p.id] === undefined) {
          votes[p.id] = 'NAHI';
        }
      }
      const events: GameEvent[] = livingPlayers(state)
        .filter((p) => votingPhase.votes[p.id] === undefined)
        .map((p) => ({ type: 'VOTE_CAST' as const, playerId: p.id, vote: 'NAHI' as const }));
      const next: GameState = {
        ...state,
        phase: { ...state.phase, votes },
        stateVersion: state.stateVersion + 1,
      };
      const revealed = revealVoting(next, events);
      if (revealed.events.some((e) => e.type === 'ACTION_REJECTED')) {
        return revealed;
      }
      return finalize(revealed.state, revealed.events, deps);
    }

    case 'RESOLVE_ELECTION': {
      return resolveElectionAfterReveal(state, [], deps);
    }

    case 'DISCARD_MAHARAJ_TILE': {
      if (state.phase.kind !== 'LEGISLATION_MAHARAJ') return reject(state, action.type, 'Not in Maharaj legislation');
      if (!state.currentGovernment || action.maharajId !== state.currentGovernment.maharajId) {
        return reject(state, action.type, 'Not the seated Maharaj');
      }
      const tile = state.phase.drawnTiles.find((t) => t.id === action.tileId);
      if (!tile) return reject(state, action.type, 'Invalid tile');
      const remaining = state.phase.drawnTiles.filter((t) => t.id !== action.tileId);
      if (remaining.length !== 2) return reject(state, action.type, 'Must leave exactly 2 tiles');
      const next: GameState = {
        ...state,
        ashPile: [...state.ashPile, tile],
        phase: {
          kind: 'LEGISLATION_SENAPATI',
          heldTiles: [remaining[0] as typeof remaining[0], remaining[1] as typeof remaining[1]],
          vetoProposed: false,
          vetoVotes: {},
        },
        stateVersion: state.stateVersion + 1,
      };
      return finalize(next, [
        { type: 'TILE_DISCARDED', tileId: tile.id, by: 'MAHARAJ' },
        { type: 'PHASE_CHANGED', from: 'LEGISLATION_MAHARAJ', to: 'LEGISLATION_SENAPATI' },
      ], deps);
    }

    case 'PROPOSE_VETO': {
      if (state.phase.kind !== 'LEGISLATION_SENAPATI') return reject(state, action.type, 'Not in Senapati legislation');
      if (!state.currentGovernment || action.senapatiId !== state.currentGovernment.senapatiId) {
        return reject(state, action.type, 'Not the seated Senapati');
      }
      if (!isVetoUnlocked(state)) return reject(state, action.type, 'Veto not unlocked');
      if (state.phase.vetoProposed) return reject(state, action.type, 'Veto already proposed');
      const next: GameState = {
        ...state,
        phase: { ...state.phase, vetoProposed: true, vetoVotes: {} },
        stateVersion: state.stateVersion + 1,
      };
      return finalize(next, [{ type: 'VETO_PROPOSED' }], deps);
    }

    case 'CAST_VETO_VOTE': {
      if (state.phase.kind !== 'LEGISLATION_SENAPATI') return reject(state, action.type, 'Not in Senapati legislation');
      if (!state.phase.vetoProposed) return reject(state, action.type, 'No veto proposed');
      if (!state.currentGovernment) return reject(state, action.type, 'No government');
      const { maharajId, senapatiId } = state.currentGovernment;
      if (action.playerId !== maharajId && action.playerId !== senapatiId) {
        return reject(state, action.type, 'Only government may vote on veto');
      }
      const vetoVotes = { ...state.phase.vetoVotes, [action.playerId]: action.vote };
      const next: GameState = {
        ...state,
        phase: { ...state.phase, vetoVotes },
        stateVersion: state.stateVersion + 1,
      };
      const mVote = vetoVotes[maharajId];
      const sVote = vetoVotes[senapatiId];
      if (mVote === undefined || sVote === undefined) {
        return finalize(next, [], deps);
      }
      if (mVote === 'HA' && sVote === 'HA') {
        const tiles = state.phase.heldTiles;
        const tile0 = tiles[0];
        const tile1 = tiles[1];
        if (!tile0 || !tile1 || tiles.length !== 2) {
          return reject(state, action.type, 'Invalid veto hand');
        }
        let tracker = next.electionTracker + 1;
        let afterVeto: GameState = {
          ...next,
          ashPile: [...next.ashPile, tile0, tile1],
          currentGovernment: null,
          electionTracker: tracker,
        };
        const vetoEvents: GameEvent[] = [
          { type: 'VETO_RESOLVED', accepted: true },
          { type: 'TILE_DISCARDED', tileId: tile0.id, by: 'VETO' },
          { type: 'TILE_DISCARDED', tileId: tile1.id, by: 'VETO' },
        ];
        if (tracker >= 3) {
          afterVeto = { ...afterVeto, phase: { kind: 'KURUKSHETRA_ANARCHY' } };
          return handleAnarchy(afterVeto, vetoEvents, deps);
        }
        afterVeto = returnToNomination({ ...afterVeto, electionTracker: tracker });
        return finalize(
          {
            ...afterVeto,
            stateVersion: afterVeto.stateVersion + 1,
          },
          [...vetoEvents, { type: 'GOVERNMENT_REJECTED', electionTracker: tracker }, { type: 'PHASE_CHANGED', from: 'LEGISLATION_SENAPATI', to: 'ELECTION_NOMINATION' }],
          deps,
        );
      }
      return finalize(next, [{ type: 'VETO_RESOLVED', accepted: false }], deps);
    }

    case 'DISCARD_SENAPATI_TILE': {
      if (state.phase.kind !== 'LEGISLATION_SENAPATI') return reject(state, action.type, 'Not in Senapati legislation');
      if (!state.currentGovernment || action.senapatiId !== state.currentGovernment.senapatiId) {
        return reject(state, action.type, 'Not the seated Senapati');
      }
      const tile = state.phase.heldTiles.find((t) => t.id === action.tileId);
      if (!tile) return reject(state, action.type, 'Invalid tile');
      const other = state.phase.heldTiles.find((t) => t.id !== action.tileId);
      if (!other) return reject(state, action.type, 'Must enact one tile');
      const next: GameState = {
        ...state,
        ashPile: [...state.ashPile, tile],
      };
      return enactDecree(
        next,
        other.type,
        other.id,
        [
          { type: 'TILE_DISCARDED', tileId: tile.id, by: 'SENAPATI' },
        ],
        false,
        deps,
      );
    }

    case 'EXEC_DIVYA_DRISHTI': {
      if (state.phase.kind !== 'EXECUTIVE_ACTION' || state.phase.power !== 'DIVYA_DRISHTI') {
        return reject(state, action.type, 'Not in Divya Drishti');
      }
      if (!state.currentGovernment || action.maharajId !== state.currentGovernment.maharajId) {
        return reject(state, action.type, 'Not the acting Maharaj');
      }
      const target = getPlayer(state, action.targetId);
      if (!target?.isAlive) return reject(state, action.type, 'Invalid target');
      if (action.targetId === action.maharajId) return reject(state, action.type, 'Cannot self-target');
      if (state.investigatedPlayerIds.includes(action.targetId)) {
        return reject(state, action.type, 'Already investigated');
      }
      const team = teamForRole(target.role as NonNullable<typeof target.role>);
      const investigations = state.privateInvestigations[action.maharajId] ?? [];
      const next = returnToNomination({
        ...state,
        investigatedPlayerIds: [...state.investigatedPlayerIds, action.targetId],
        privateInvestigations: {
          ...state.privateInvestigations,
          [action.maharajId]: [...investigations, { targetPlayerId: action.targetId, team }],
        },
        currentGovernment: null,
        stateVersion: state.stateVersion + 1,
      });
      return finalize(next, [
        { type: 'INVESTIGATION_RESULT', maharajId: action.maharajId, targetId: action.targetId, team },
        { type: 'PHASE_CHANGED', from: 'EXECUTIVE_ACTION', to: 'ELECTION_NOMINATION' },
      ], deps);
    }

    case 'EXEC_RAJYA_SABHA_SUMMONS': {
      if (state.phase.kind !== 'EXECUTIVE_ACTION' || state.phase.power !== 'RAJYA_SABHA_SUMMONS') {
        return reject(state, action.type, 'Not in Rajya Sabha Summons');
      }
      if (!state.currentGovernment || action.maharajId !== state.currentGovernment.maharajId) {
        return reject(state, action.type, 'Not the acting Maharaj');
      }
      const target = getPlayer(state, action.targetId);
      if (!target?.isAlive) return reject(state, action.type, 'Invalid target');
      if (action.targetId === action.maharajId) return reject(state, action.type, 'Must pick another player');
      const returnAfter = nextLivingPlayerId(state, action.maharajId);
      const next: GameState = {
        ...state,
        maharajCandidateId: action.targetId,
        senapatiCandidateId: null,
        summonsReturnAfterPlayerId: returnAfter,
        currentGovernment: null,
        phase: { kind: 'ELECTION_NOMINATION' },
        stateVersion: state.stateVersion + 1,
      };
      return finalize(next, [
        { type: 'SUMMONS_CALLED', targetId: action.targetId, returnAfterPlayerId: returnAfter ?? '' },
        { type: 'PHASE_CHANGED', from: 'EXECUTIVE_ACTION', to: 'ELECTION_NOMINATION' },
      ], deps);
    }

    case 'EXEC_AKASHVANI_ACK': {
      if (state.phase.kind !== 'EXECUTIVE_ACTION' || state.phase.power !== 'AKASHVANI') {
        return reject(state, action.type, 'Not in Akashvani');
      }
      if (!state.currentGovernment || action.maharajId !== state.currentGovernment.maharajId) {
        return reject(state, action.type, 'Not the acting Maharaj');
      }
      const peeked = state.decreeDeck.slice(0, 3);
      const next = returnToNomination({
        ...state,
        currentGovernment: null,
        stateVersion: state.stateVersion + 1,
      });
      return finalize(next, [
        {
          type: 'AKASHVANI_PEEK',
          maharajId: action.maharajId,
          tileIds: peeked.map((t) => t.id),
        },
        { type: 'PHASE_CHANGED', from: 'EXECUTIVE_ACTION', to: 'ELECTION_NOMINATION' },
      ], deps);
    }

    case 'EXEC_VANVAS': {
      if (state.phase.kind !== 'EXECUTIVE_ACTION' || state.phase.power !== 'VANVAS') {
        return reject(state, action.type, 'Not in Vanvas');
      }
      if (!state.currentGovernment || action.maharajId !== state.currentGovernment.maharajId) {
        return reject(state, action.type, 'Not the acting Maharaj');
      }
      const target = getPlayer(state, action.targetId);
      if (!target?.isAlive) return reject(state, action.type, 'Invalid target');
      if (action.targetId === action.maharajId) return reject(state, action.type, 'Cannot self-target');

      const vanvasWin = checkVanvasWin(state, action.targetId);
      const players = state.players.map((p) =>
        p.id === action.targetId ? { ...p, isAlive: false } : p,
      );
      const exileEvent: GameEvent = { type: 'PLAYER_EXILED', playerId: action.targetId };
      const withExile = {
        ...state,
        players,
        lastExiledPlayerId: action.targetId,
      };

      if (vanvasWin) {
        const over = applyGameOver(
          { ...withExile, currentGovernment: null },
          vanvasWin.winner,
          vanvasWin.reason,
          [exileEvent],
        );
        return finalize(over.state, over.events, deps);
      }

      const next = returnToNomination({
        ...withExile,
        currentGovernment: null,
        stateVersion: state.stateVersion + 1,
      });
      return finalize(next, [
        exileEvent,
        { type: 'PHASE_CHANGED', from: 'EXECUTIVE_ACTION', to: 'ELECTION_NOMINATION' },
      ], deps);
    }

    case 'ADVANCE_AFTER_DECREE': {
      return advanceAfterDecreeCeremony(state, deps);
    }

    case 'FORCE_END_GAME': {
      if (action.hostPlayerId !== state.hostPlayerId) {
        return reject(state, action.type, 'Only host may force end');
      }
      const result = applyGameOver(state, action.winner, 'HOST_FORCE_END', []);
      return finalize(result.state, result.events, deps);
    }

    default: {
      const _exhaustive: never = action;
      return reject(state, (_exhaustive as GameAction).type, 'Unknown action');
    }
  }
}
