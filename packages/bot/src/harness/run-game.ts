import type { MemoryPersistence } from '@shaatir-shakuni/server';
import type { WirePlayerView } from '@shaatir-shakuni/socket-api';
import { BotClient } from './bot-client.js';
import { formatGameEvent } from './game-events.js';
import type { Narrator } from './narrator.js';
import { mulberry32 } from './rng.js';
import { ALL_WIRE_POLICY_NAMES, decideWireAction, type WirePolicyName } from '../policies.js';

const TERMINAL_PHASES = new Set(['GAME_OVER', 'ROOM_FROZEN', 'ROOM_CORRUPTED']);

/**
 * Rejection codes that are an *expected* side effect of several independent
 * bots acting at once (e.g. everyone voting in the same instant) rather than
 * a sign of a real server/client bug. Logged distinctly so they don't drown
 * out genuinely surprising rejections in the narration.
 */
const CONCURRENCY_REJECT_CODES = new Set([
  'STATE_VERSION_MISMATCH',
  'SEQUENCE_REJECTED',
  'RATE_LIMITED',
]);

export interface RunGameOptions {
  readonly url: string;
  /**
   * Present only for self-booted throwaway servers, where the harness can read
   * committed `GameEvent`s directly for rich narration. Omit when pointing at a
   * real (e.g. production) deployment — narration then falls back to wire-only
   * events (views, rejections, errors) which is everything a real client sees.
   */
  readonly memory?: MemoryPersistence;
  readonly playerCount: number;
  readonly narrator: Narrator;
  readonly seed?: number;
  /** Delay (ms) before a bot submits its next action — lets a human follow along. 0 = full speed. */
  readonly speedMs?: number;
  /** Abort the game if no `state:update` arrives for this long (deadlock detector). */
  readonly stallTimeoutMs?: number;
  readonly rebalanceEnabled?: boolean;
  /** Override policy-per-seat; defaults to a round-robin mix of all wire policies. */
  readonly policyAssignment?: readonly WirePolicyName[];
  /**
   * When true, randomly injects disconnect/reconnect, artificial latency,
   * duplicate clicks, and stale stateVersion probes during the match.
   */
  readonly chaosEnabled?: boolean;
}

export interface RunGameResult {
  readonly ok: boolean;
  readonly roomCode: string;
  readonly winner?: string;
  readonly winReason?: string;
  readonly finalPhase: string;
  /** Total anomaly count, including benign `concurrency_conflict` races. */
  readonly anomalies: number;
  /** Anomalies excluding `concurrency_conflict` — the signal worth investigating. */
  readonly hardAnomalies: number;
  readonly durationMs: number;
  readonly policyAssignment: readonly WirePolicyName[];
  /** Chaos events injected during the match (empty when chaos disabled). */
  readonly chaosEvents: readonly string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drives one complete game end-to-end over real Socket.IO connections:
 * boots N bot clients, has them create/join/start a room, then reacts to
 * every `state:update` with a policy-chosen action until the game reaches
 * GAME_OVER (or ROOM_FROZEN/ROOM_CORRUPTED, or a stall is detected).
 */
export async function runGame(opts: RunGameOptions): Promise<RunGameResult> {
  const { url, memory, playerCount, narrator } = opts;
  if (playerCount < 5 || playerCount > 10) {
    throw new Error(`playerCount must be between 5 and 10 (got ${playerCount})`);
  }
  const rng = mulberry32(opts.seed ?? Date.now() & 0xffffffff);
  const speedMs = opts.speedMs ?? 0;
  const stallTimeoutMs = opts.stallTimeoutMs ?? 20_000;
  const chaosEnabled = opts.chaosEnabled ?? false;
  const policies: WirePolicyName[] = opts.policyAssignment
    ? [...opts.policyAssignment]
    : Array.from(
        { length: playerCount },
        (_, i) => ALL_WIRE_POLICY_NAMES[i % ALL_WIRE_POLICY_NAMES.length]!,
      );

  const startedAt = Date.now();
  const names = Array.from({ length: playerCount }, (_, i) => `Bot-${i + 1}`);
  // A same-machine throwaway server resolves well under 500ms; a real
  // deployment (Railway, cross-region) needs a wider backstop so this
  // timer doesn't race ahead of a genuinely-in-flight rejection (see
  // `BotClient.pendingResolveTimeoutMs`).
  const pendingResolveTimeoutMs = memory ? 500 : 3_000;
  const bots = names.map((name) => new BotClient(url, name, pendingResolveTimeoutMs));
  const nameById = new Map<string, string>();
  const nameOf = (id: string): string => nameById.get(id) ?? id;

  const expectingRejection = names.map(() => false);
  const triedNominees = names.map(() => new Set<string>());
  const lastMaharajCandidate = names.map((): string | null => null);
  const scheduling = names.map(() => false);
  const chaosEvents: string[] = [];
  const reconnecting = names.map(() => false);

  let finished = false;
  let lastViewAtMs = Date.now();
  /** Stall detector keys off stateVersion advances, not mere reconnect syncs. */
  let lastProgressVersion = -1;
  let lastProgressAtMs = Date.now();
  let lastDrainedEventCount = 0;
  let roomCode = '';
  let roomId = '';

  let resolveMain!: (result: RunGameResult) => void;
  const done = new Promise<RunGameResult>((resolve) => {
    resolveMain = resolve;
  });

  function drainEvents(): void {
    if (!roomId || !memory) return;
    const events = memory.getEvents(roomId);
    for (let i = lastDrainedEventCount; i < events.length; i += 1) {
      const ev = events[i]!;
      narrator.line(formatGameEvent(ev.payload, nameOf));
      if (ev.payload.type === 'ROOM_FAILURE') {
        narrator.anomaly(
          ev.payload.mode === 'ROOM_FROZEN' ? 'room_frozen' : 'room_corrupted',
          ev.payload.reason,
        );
      }
    }
    lastDrainedEventCount = events.length;
  }

  function finish(view: WirePlayerView | null, finalPhaseOverride?: string): void {
    if (finished) return;
    finished = true;
    drainEvents();
    for (const bot of bots) bot.close();
    const finalPhase = finalPhaseOverride ?? view?.phase.kind ?? 'UNKNOWN';
    // Under chaos, `unexpected_rejection` is frequently a bot-side race
    // (stale intent after reconnect, double-click after a peer advanced the
    // phase) rather than a server bug — treat it as soft noise like
    // concurrency_conflict. Real integrity failures (stall/freeze/crash/
    // schema) remain hard.
    const softKinds = chaosEnabled
      ? new Set(['concurrency_conflict', 'unexpected_rejection'])
      : new Set(['concurrency_conflict']);
    resolveMain({
      ok: finalPhase === 'GAME_OVER',
      roomCode,
      winner: view?.winner ?? undefined,
      winReason: view?.winReason ?? undefined,
      finalPhase,
      anomalies: narrator.anomalies.length,
      hardAnomalies: narrator.anomalies.filter((a) => !softKinds.has(a.kind)).length,
      durationMs: Date.now() - startedAt,
      policyAssignment: policies,
      chaosEvents,
    });
  }

  type ChaosPlan =
    | { readonly kind: 'none' }
    | { readonly kind: 'skip_tick' }
    | { readonly kind: 'latency'; readonly delayMs: number }
    | { readonly kind: 'stale' }
    | { readonly kind: 'duplicate' };

  async function planChaos(idx: number, bot: BotClient): Promise<ChaosPlan> {
    if (!chaosEnabled || finished || reconnecting[idx]) return { kind: 'none' };
    const phaseKind = bot.view?.phase.kind;
    // Never chaos-disconnect in LOBBY: the host's startGame() is issued from
    // the setup path, and a mid-lobby drop leaves ROOM_START on a dead socket
    // (PLAYER_NOT_IN_ROOM) while the room never leaves LOBBY — false STALLED.
    if (
      !phaseKind ||
      phaseKind === 'LOBBY' ||
      phaseKind === 'GAME_OVER' ||
      phaseKind === 'ROOM_FROZEN' ||
      phaseKind === 'ROOM_CORRUPTED'
    ) {
      return { kind: 'none' };
    }
    const roll = rng();
    // ~5% chance of some chaos on each decision tick (reconnect rarer —
    // it's the heaviest path and otherwise dominates the chaos log).
    if (roll > 0.05) return { kind: 'none' };

    if (roll < 0.01 && bot.authToken) {
      reconnecting[idx] = true;
      chaosEvents.push(`reconnect:${names[idx]}`);
      narrator.line(`(chaos) ${names[idx]} drops connection and reconnects.`);
      try {
        bot.dropConnection();
        await sleep(50 + Math.floor(rng() * 200));
        await bot.reconnectSession();
        lastViewAtMs = Date.now();
        if (bot.view && bot.view.stateVersion > lastProgressVersion) {
          lastProgressVersion = bot.view.stateVersion;
          lastProgressAtMs = Date.now();
        }
        if (process.env['BOT_DEBUG']) {
          // eslint-disable-next-line no-console
          console.log(
            `[debug] ${names[idx]} reconnected phase=${bot.view?.phase.kind} v=${bot.view?.stateVersion} pending=${bot.hasPendingAction}`,
          );
        }
      } catch (err) {
        narrator.anomaly(
          'crash',
          `${names[idx]} reconnect failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        reconnecting[idx] = false;
      }
      return { kind: 'skip_tick' };
    }

    if (roll < 0.025) {
      const delayMs = 100 + Math.floor(rng() * 400);
      chaosEvents.push(`latency:${names[idx]}:${delayMs}ms`);
      return { kind: 'latency', delayMs };
    }

    if (roll < 0.037) {
      chaosEvents.push(`stale_packet:${names[idx]}`);
      return { kind: 'stale' };
    }

    chaosEvents.push(`duplicate_click:${names[idx]}`);
    return { kind: 'duplicate' };
  }

  const stallInterval = setInterval(() => {
    if (finished) return;
    // Prefer stateVersion progress: chaos reconnects emit state:sync without
    // advancing the game and would otherwise indefinitely postpone stall detection.
    const idleMs = Date.now() - lastProgressAtMs;
    if (idleMs > stallTimeoutMs) {
      narrator.anomaly(
        'stall',
        `No stateVersion progress for over ${stallTimeoutMs}ms (lastVersion=${lastProgressVersion}) — the room may be deadlocked.`,
      );
      clearInterval(stallInterval);
      finish(null, 'STALLED');
    }
  }, 1000);

  async function react(idx: number, bot: BotClient, view: WirePlayerView): Promise<void> {
    if (finished || !bot.playerId || bot.hasPendingAction || scheduling[idx] || reconnecting[idx]) {
      return;
    }
    if (view.maharajCandidateId !== lastMaharajCandidate[idx]) {
      lastMaharajCandidate[idx] = view.maharajCandidateId;
      triedNominees[idx]!.clear();
    }

    const chaos = await planChaos(idx, bot);
    if (chaos.kind === 'skip_tick') {
      if (!finished && bot.view) void react(idx, bot, bot.view);
      return;
    }

    const decision = decideWireAction(
      {
        view: bot.view ?? view,
        selfId: bot.playerId,
        rng,
        triedNominees: triedNominees[idx]!,
      },
      policies[idx]!,
    );
    if (process.env['BOT_DEBUG']) {
      // eslint-disable-next-line no-console
      console.log(
        `[debug] react ${names[idx]} phase=${view.phase.kind} maharaj=${view.maharajCandidateId===bot.playerId} decision=${decision.kind}`,
      );
    }
    if (decision.kind === 'none') return;
    if (decision.kind === 'skip') {
      // Simulated AFK tick. In production an AFK player is eventually
      // resolved by the server's own timers (CAST_DEFAULT_VOTES / role-reveal
      // timeout), but those run on human timescales. Retry shortly so a
      // `disconnect-sim` bot doesn't permanently stall an automated match —
      // it still exercises the "this player is briefly unresponsive" path,
      // just without waiting for the full production AFK window.
      setTimeout(() => {
        if (!finished && bot.view) void react(idx, bot, bot.view);
      }, 1500);
      return;
    }
    // Illegal probes, stale stateVersion, and rapid double-clicks are all
    // expected to draw a rejection (or ACTION_DEDUPED) — not hard anomalies.
    if (
      decision.kind === 'illegal' ||
      chaos.kind === 'stale' ||
      chaos.kind === 'duplicate'
    ) {
      expectingRejection[idx] = true;
    }
    if (decision.payload.type === 'NOMINATE_SENAPATI') {
      triedNominees[idx]!.add(decision.payload.nomineeId);
    }
    scheduling[idx] = true;
    try {
      // Even at full speed, a tiny random jitter spreads out the very common
      // case of several bots reacting to the same broadcast simultaneously
      // (e.g. everyone voting at once), which otherwise reliably collides on
      // `stateVersion` and burns retries/rate-limit tokens for no benefit.
      let jitterMs = speedMs > 0 ? speedMs : Math.random() * 30;
      if (chaos.kind === 'latency') jitterMs += chaos.delayMs;
      await sleep(jitterMs);
      if (finished || bot.hasPendingAction) return;
      if (chaos.kind === 'stale') {
        bot.sendStaleGameAction(decision.payload);
      } else if (chaos.kind === 'duplicate') {
        bot.sendDuplicateGameAction(decision.payload);
      } else {
        bot.sendGameAction(decision.payload);
      }
    } finally {
      scheduling[idx] = false;
    }
  }

  bots.forEach((bot, idx) => {
    bot.on('view', (view) => {
      lastViewAtMs = Date.now();
      if (view.stateVersion > lastProgressVersion) {
        lastProgressVersion = view.stateVersion;
        lastProgressAtMs = Date.now();
      }
      if (finished) return;
      drainEvents();
      if (TERMINAL_PHASES.has(view.phase.kind)) {
        finish(view);
        return;
      }
      void react(idx, bot, view);
    });
    bot.on('rejected', (payload) => {
      const label = names[idx];
      if (expectingRejection[idx]) {
        expectingRejection[idx] = false;
        narrator.line(`(expected) ${label} probe rejected: ${payload.code} — ${payload.message}`);
      } else if (CONCURRENCY_REJECT_CODES.has(payload.code)) {
        narrator.anomaly(
          'concurrency_conflict',
          `${label} action rejected: ${payload.code} — ${payload.message}`,
        );
      } else {
        narrator.anomaly(
          'unexpected_rejection',
          `${label} action rejected: ${payload.code} — ${payload.message}`,
        );
      }
    });
    bot.on('frozen', (payload) => {
      narrator.anomaly(
        payload.mode === 'FROZEN' ? 'room_frozen' : 'room_corrupted',
        `${names[idx]} was notified: ${payload.reasonCategory}`,
      );
    });
    bot.on('serverError', (payload) => {
      narrator.anomaly('crash', `${names[idx]} got server error ${payload.code}: ${payload.message}`);
    });
    bot.on('invalidPayload', (payload) => {
      narrator.anomaly(
        'invalid_payload',
        `${names[idx]} received a "${payload.event}" payload that failed schema validation`,
      );
    });
    bot.on('protocolMismatch', (clientVersion, serverVersion) => {
      narrator.anomaly(
        'protocol_mismatch',
        `${names[idx]}: client=${clientVersion} server=${serverVersion}`,
      );
    });
    bot.on('readOnly', () => {
      narrator.anomaly('crash', `${names[idx]} was unexpectedly demoted to read-only`);
    });
    bot.on('disconnected', (reason) => {
      if (!finished && !reconnecting[idx]) {
        narrator.anomaly('unexpected_disconnect', `${names[idx]} disconnected: ${reason}`);
      }
    });
    bot.on('connectError', (message) => {
      narrator.anomaly('crash', `${names[idx]} failed to connect: ${message}`);
    });
    bot.on('unblocked', () => {
      if (process.env['BOT_DEBUG']) {
        console.log(`[debug] ${names[idx]} unblocked, finished=${finished}, hasView=${!!bot.view}`);
      }
      if (finished || !bot.view) return;
      void react(idx, bot, bot.view);
    });
  });

  try {
    await Promise.all(bots.map((bot) => bot.connect()));

    const host = bots[0]!;
    const hostSession = await host.createRoom(opts.rebalanceEnabled);
    roomCode = hostSession.roomCode;
    roomId = hostSession.roomId;
    nameById.set(hostSession.playerId, names[0]!);
    narrator.line(`Room ${roomCode} created by ${names[0]} (host). Policy: ${policies[0]}.`);

    for (let i = 1; i < bots.length; i += 1) {
      const bot = bots[i]!;
      const session = await bot.joinRoom(roomCode);
      nameById.set(session.playerId, names[i]!);
      narrator.line(`${names[i]} joined (${i + 1}/${playerCount}). Policy: ${policies[i]}.`);
    }

    // Wait out any in-flight host reconnect chaos before ROOM_START.
    for (let i = 0; i < 50 && reconnecting[0]; i += 1) {
      await sleep(50);
    }
    if (!host.authToken || host.view?.phase.kind !== 'LOBBY') {
      throw new Error('Host not ready in LOBBY to start the game');
    }
    narrator.line(`${names[0]} (host) starts the game.`);
    host.startGame();
  } catch (err) {
    clearInterval(stallInterval);
    narrator.anomaly('crash', `Setup failed: ${err instanceof Error ? err.message : String(err)}`);
    finish(null, 'SETUP_FAILED');
  }

  const result = await done;
  clearInterval(stallInterval);
  return result;
}
