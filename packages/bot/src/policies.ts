import type { GameActionPayload, WirePlayerView } from '@shaatir-shakuni/socket-api';

export type WirePolicyName =
  | 'random'
  | 'always-veto'
  | 'always-reject'
  | 'duryodhana-seeking'
  | 'disconnect-sim'
  | 'loyalist'
  | 'paranoid';

export const ALL_WIRE_POLICY_NAMES: readonly WirePolicyName[] = [
  'random',
  'always-veto',
  'always-reject',
  'duryodhana-seeking',
  'disconnect-sim',
  'loyalist',
  'paranoid',
];

/** Base think delay (ms) before a bot submits — used by watch-ui / browser matrix. */
export const POLICY_THINK_DELAY_MS: Readonly<Record<WirePolicyName, number>> = {
  random: 2_200,
  'always-veto': 1_600,
  'always-reject': 1_800,
  'duryodhana-seeking': 2_800,
  'disconnect-sim': 900,
  loyalist: 3_200,
  paranoid: 5_500,
};

export type Rng = () => number;

export interface WirePolicyContext {
  readonly view: WirePlayerView;
  readonly selfId: string;
  readonly rng: Rng;
  /**
   * Nominee ids already attempted (and rejected) for the current
   * `maharajCandidateId` round — lets the agent avoid re-proposing the same
   * illegal nominee forever. Reset by the caller whenever the round changes.
   */
  readonly triedNominees: ReadonlySet<string>;
}

export type WireDecision =
  /** Submit this payload — expected to be legal. */
  | { readonly kind: 'action'; readonly payload: GameActionPayload }
  /**
   * Deliberately submit a payload that should be illegal right now (wrong
   * phase/role) to confirm the server rejects it cleanly. Only ever produced
   * by `disconnect-sim`.
   */
  | { readonly kind: 'illegal'; readonly payload: GameActionPayload }
  /** Deliberately stay silent this tick (AFK/disconnect probe). */
  | { readonly kind: 'skip' }
  /** Nothing to do — no legal action available for this player right now. */
  | { readonly kind: 'none' };

function pickRandom<T>(items: readonly T[], rng: Rng): T {
  const idx = Math.floor(rng() * items.length);
  return items[Math.min(idx, items.length - 1)]!;
}

function shuffleInPlace<T>(items: T[], rng: Rng): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
}

function aliveOthers(view: WirePlayerView, selfId: string): readonly string[] {
  return view.players.filter((p) => p.isAlive && p.id !== selfId).map((p) => p.id);
}

/** Team-aware ids self believes are "friendly" — best effort from wire-visible info only. */
function friendlyIds(view: WirePlayerView, selfId: string): ReadonlySet<string> {
  const set = new Set(view.knownKauravas);
  if (view.knownDuryodhanaId) set.add(view.knownDuryodhanaId);
  if (view.ownRole === 'DURYODHANA') set.add(selfId);
  return set;
}

function isDeadOrMissing(view: WirePlayerView, id: string): boolean {
  const p = view.players.find((pp) => pp.id === id);
  return !p || !p.isAlive;
}

/**
 * Mirrors engine `isSenapatiEligible` term-limit half using wire-visible
 * `lastElectedGovernment` + living count (5-player: only Senapati limited).
 */
function termLimitedIdsFromView(view: WirePlayerView): ReadonlySet<string> {
  const last = view.lastElectedGovernment;
  if (!last) return new Set();
  const living = view.players.filter((p) => p.isAlive).length;
  if (living === 5) return new Set([last.senapatiId]);
  return new Set([last.maharajId, last.senapatiId]);
}

/**
 * Chooses a Senapati nominee, avoiding the just-outgoing government as a
 * heuristic against term-limit rejections (exact term-limit rules are
 * engine-enforced; this is only a bot courtesy to reduce noisy rejections).
 */
function chooseNominee(
  ctx: WirePolicyContext,
  preferFriendly: boolean,
  avoidKnownKauravas: boolean,
): string | null {
  const { view, selfId, rng, triedNominees } = ctx;
  const outgoing = new Set([
    ...termLimitedIdsFromView(view),
    ...(view.currentGovernment
      ? [view.currentGovernment.maharajId, view.currentGovernment.senapatiId]
      : []),
  ]);
  let pool = aliveOthers(view, selfId).filter(
    (id) => !outgoing.has(id) && !triedNominees.has(id),
  );
  if (pool.length === 0) {
    pool = aliveOthers(view, selfId).filter((id) => !triedNominees.has(id));
  }
  if (pool.length === 0) {
    pool = [...aliveOthers(view, selfId)];
  }
  if (pool.length === 0) return null;

  if (avoidKnownKauravas) {
    const friends = friendlyIds(view, selfId);
    const safe = pool.filter((id) => !friends.has(id));
    if (safe.length > 0) pool = safe;
  }

  if (preferFriendly) {
    const friends = friendlyIds(view, selfId);
    const friendlyPool = pool.filter((id) => friends.has(id));
    if (friendlyPool.length > 0) {
      return pickRandom(friendlyPool, rng);
    }
  }
  return pickRandom(pool, rng);
}

function decideVote(ctx: WirePolicyContext, name: WirePolicyName): 'HA' | 'NAHI' {
  const { view, rng } = ctx;
  if (name === 'always-reject' || name === 'paranoid') {
    if (name === 'paranoid') return rng() < 0.85 ? 'NAHI' : 'HA';
    return 'NAHI';
  }
  if (name === 'loyalist') return rng() < 0.8 ? 'HA' : 'NAHI';
  if (name === 'duryodhana-seeking') {
    const friends = friendlyIds(view, ctx.selfId);
    const candidate = view.senapatiCandidateId;
    if (candidate && friends.has(candidate)) return 'HA';
    if (candidate && !friends.has(candidate)) return rng() < 0.75 ? 'NAHI' : 'HA';
  }
  return rng() < 0.5 ? 'HA' : 'NAHI';
}

/**
 * Assign one policy per seat. When `playerCount ≤` policy count, all seats get
 * unique policies. Otherwise shuffle with replacement but never let two adjacent
 * seats share the same policy.
 */
export function assignDistinctPolicies(
  playerCount: number,
  rng: Rng,
): WirePolicyName[] {
  const pool = [...ALL_WIRE_POLICY_NAMES];
  shuffleInPlace(pool, rng);

  if (playerCount <= pool.length) {
    return pool.slice(0, playerCount);
  }

  const out: WirePolicyName[] = [];
  for (let i = 0; i < playerCount; i += 1) {
    const prev = out[i - 1];
    let pick = pool[i % pool.length]!;
    // Prefer a different policy than the previous seat.
    if (pick === prev) {
      const alt = pool.find((p) => p !== prev) ?? pick;
      pick = alt;
    }
    // Light extra shuffle so later seats aren't a pure round-robin.
    if (rng() < 0.35) {
      const candidates = pool.filter((p) => p !== prev);
      if (candidates.length > 0) pick = pickRandom(candidates, rng);
    }
    out.push(pick);
  }
  return out;
}

/** Think delay with ±25% jitter (or scaled by `speedScale`, e.g. `--fast` → 0.15). */
export function thinkDelayMs(
  name: WirePolicyName,
  rng: Rng,
  speedScale = 1,
): number {
  const base = POLICY_THINK_DELAY_MS[name] * speedScale;
  const jitter = 0.75 + rng() * 0.5;
  return Math.max(50, Math.round(base * jitter));
}

/** Wire-view-only reimplementation of `packages/sim`'s policies (see there for the intent). */
export function decideWireAction(ctx: WirePolicyContext, name: WirePolicyName): WireDecision {
  const { view, selfId, rng } = ctx;
  const phase = view.phase;

  // Exiled (Vanvas) players become spectators and cannot submit any action —
  // matches the real client's own `isSpectator` guard.
  if (view.isSpectator) return { kind: 'none' };

  switch (phase.kind) {
    case 'LOBBY':
    case 'GAME_OVER':
    case 'ROOM_FROZEN':
    case 'ROOM_CORRUPTED':
      return { kind: 'none' };

    case 'ROLE_REVEAL': {
      if (name === 'disconnect-sim' && rng() < 0.15) {
        return { kind: 'skip' };
      }
      if ((phase.pendingAcks ?? []).includes(selfId)) {
        return { kind: 'action', payload: { type: 'ACK_ROLE_REVEAL' } };
      }
      return { kind: 'none' };
    }

    case 'DISCUSSION_PRE_VOTE':
    case 'DECREE_CEREMONY': {
      if ((phase.pendingDone ?? []).includes(selfId)) {
        return { kind: 'action', payload: { type: 'DONE_DISCUSSING' } };
      }
      return { kind: 'none' };
    }

    case 'KURUKSHETRA_ANARCHY':
      return { kind: 'none' };

    case 'ELECTION_NOMINATION': {
      if (view.maharajCandidateId !== selfId) return { kind: 'none' };
      if (name === 'disconnect-sim' && rng() < 0.2) {
        // Ineligible-target probe: nominate self, which must always be illegal.
        return { kind: 'illegal', payload: { type: 'NOMINATE_SENAPATI', nomineeId: selfId } };
      }
      const nomineeId = chooseNominee(
        ctx,
        name === 'duryodhana-seeking',
        name === 'paranoid',
      );
      if (!nomineeId) return { kind: 'none' };
      return { kind: 'action', payload: { type: 'NOMINATE_SENAPATI', nomineeId } };
    }

    case 'ELECTION_VOTING': {
      if (view.votesRevealed || phase.votesRevealed) {
        if ((phase.pendingDone ?? []).includes(selfId)) {
          return { kind: 'action', payload: { type: 'DONE_DISCUSSING' } };
        }
        return { kind: 'none' };
      }
      const alreadyVoted = view.votes?.[selfId] !== undefined || phase.votes?.[selfId] !== undefined;
      if (alreadyVoted) return { kind: 'none' };
      if (name === 'disconnect-sim' && rng() < 0.15) {
        return { kind: 'skip' };
      }
      return { kind: 'action', payload: { type: 'CAST_VOTE', vote: decideVote(ctx, name) } };
    }

    case 'LEGISLATION_MAHARAJ': {
      const tiles = phase.drawnTiles ?? [];
      if (tiles.length !== 3) return { kind: 'none' };
      if (name === 'disconnect-sim' && rng() < 0.15) return { kind: 'skip' };
      let tileId: string;
      if (name === 'loyalist') {
        const adharma = tiles.find((t) => t.type === 'ADHARMA');
        tileId = (adharma ?? pickRandom(tiles, rng)).id;
      } else if (name === 'always-reject' || name === 'duryodhana-seeking' || name === 'paranoid') {
        const adharma = tiles.find((t) => t.type === 'ADHARMA');
        // Paranoid discards Dharma when possible (keep Adharma options); seeking keeps Adharma.
        if (name === 'paranoid') {
          const dharma = tiles.find((t) => t.type === 'DHARMA');
          tileId = (dharma ?? pickRandom(tiles, rng)).id;
        } else {
          tileId = (adharma ?? pickRandom(tiles, rng)).id;
        }
      } else {
        tileId = pickRandom(tiles, rng).id;
      }
      return { kind: 'action', payload: { type: 'DISCARD_MAHARAJ_TILE', tileId } };
    }

    case 'LEGISLATION_SENAPATI': {
      const isSenapati = (phase.heldTiles ?? []).length === 2;
      const isMaharaj = view.currentGovernment?.maharajId === selfId;

      if (phase.vetoProposed && isMaharaj) {
        const already = phase.vetoVotes?.[selfId] !== undefined;
        if (!already) {
          const vote =
            name === 'always-veto' || name === 'paranoid'
              ? 'HA'
              : name === 'loyalist'
                ? 'NAHI'
                : decideVote(ctx, name);
          return { kind: 'action', payload: { type: 'CAST_VETO_VOTE', vote } };
        }
        return { kind: 'none' };
      }

      if (!isSenapati) return { kind: 'none' };
      if (name === 'disconnect-sim' && rng() < 0.15) return { kind: 'skip' };

      if (name === 'always-veto' && view.vetoUnlocked && !phase.vetoProposed) {
        return { kind: 'action', payload: { type: 'PROPOSE_VETO' } };
      }

      const held = phase.heldTiles ?? [];
      let tileId: string;
      if (name === 'loyalist') {
        // Discard Adharma so Dharma is enacted when possible.
        const adharma = held.find((t) => t.type === 'ADHARMA');
        tileId = (adharma ?? pickRandom(held, rng)).id;
      } else if (name === 'always-reject' || name === 'paranoid') {
        const dharma = held.find((t) => t.type === 'DHARMA');
        tileId = (dharma ?? pickRandom(held, rng)).id;
      } else if (name === 'duryodhana-seeking') {
        const dharma = held.find((t) => t.type === 'DHARMA');
        tileId = (dharma ?? pickRandom(held, rng)).id;
      } else {
        tileId = pickRandom(held, rng).id;
      }
      return { kind: 'action', payload: { type: 'DISCARD_SENAPATI_TILE', tileId } };
    }

    case 'EXECUTIVE_ACTION': {
      const isMaharaj = view.currentGovernment?.maharajId === selfId;
      if (!isMaharaj && phase.power !== 'AKASHVANI') return { kind: 'none' };
      if (!isMaharaj) return { kind: 'none' };

      switch (phase.power) {
        case 'DIVYA_DRISHTI': {
          const targets = aliveOthers(view, selfId).filter(
            (id) => !view.ownInvestigations.some((inv) => inv.targetPlayerId === id),
          );
          const pool = targets.length > 0 ? targets : aliveOthers(view, selfId);
          if (pool.length === 0) return { kind: 'none' };
          const targetId =
            name === 'duryodhana-seeking' || name === 'paranoid'
              ? pool.find((id) => !friendlyIds(view, selfId).has(id)) ?? pickRandom(pool, rng)
              : pickRandom(pool, rng);
          return { kind: 'action', payload: { type: 'EXEC_DIVYA_DRISHTI', targetId } };
        }
        case 'RAJYA_SABHA_SUMMONS': {
          const pool = aliveOthers(view, selfId);
          if (pool.length === 0) return { kind: 'none' };
          return {
            kind: 'action',
            payload: { type: 'EXEC_RAJYA_SABHA_SUMMONS', targetId: pickRandom(pool, rng) },
          };
        }
        case 'AKASHVANI':
          return { kind: 'action', payload: { type: 'EXEC_AKASHVANI_ACK' } };
        case 'VANVAS': {
          const friends = friendlyIds(view, selfId);
          const pool = aliveOthers(view, selfId).filter((id) => !isDeadOrMissing(view, id));
          if (pool.length === 0) return { kind: 'none' };
          const nonFriendly = pool.filter((id) => !friends.has(id));
          const targetId =
            (name === 'duryodhana-seeking' || name === 'paranoid') && nonFriendly.length > 0
              ? pickRandom(nonFriendly, rng)
              : pickRandom(pool, rng);
          return { kind: 'action', payload: { type: 'EXEC_VANVAS', targetId } };
        }
        default:
          return { kind: 'none' };
      }
    }

    default:
      return { kind: 'none' };
  }
}
