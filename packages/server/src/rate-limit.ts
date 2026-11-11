/**
 * Per-socket token-bucket rate limiting (fragments 08 + 13-security-hardening).
 * Keyed by socket id for socket events; admin HTTP uses a separate key (IP).
 */

export type NowMsFn = () => number;

export type TokenBucketConfig = {
  readonly capacity: number;
  readonly refillPerSecond: number;
};

/** `game:action` — capacity 10, refill 5/sec. */
export const GAME_ACTION_BUCKET: TokenBucketConfig = {
  capacity: 10,
  refillPerSecond: 5,
};

/** `chat:send` — capacity 5, refill 2/sec. */
export const CHAT_SEND_BUCKET: TokenBucketConfig = {
  capacity: 5,
  refillPerSecond: 2,
};

/** Unauthenticated `room:create` — capacity 3, refill 0.5/sec. */
export const ROOM_CREATE_BUCKET: TokenBucketConfig = {
  capacity: 3,
  refillPerSecond: 0.5,
};

/** Unauthenticated `room:join` — capacity 5, refill 1/sec. */
export const ROOM_JOIN_BUCKET: TokenBucketConfig = {
  capacity: 5,
  refillPerSecond: 1,
};

/** Unauthenticated `session:reconnect` — capacity 5, refill 1/sec. */
export const SESSION_RECONNECT_BUCKET: TokenBucketConfig = {
  capacity: 5,
  refillPerSecond: 1,
};

/** Admin HTTP mutations — capacity 10, refill 2/sec (keyed by client IP). */
export const ADMIN_MUTATION_BUCKET: TokenBucketConfig = {
  capacity: 10,
  refillPerSecond: 2,
};

/** Safe player-facing message for `RATE_LIMITED` rejects. */
export const RATE_LIMITED_MESSAGE = 'Too many requests; please slow down';

type BucketState = {
  tokens: number;
  lastRefillMs: number;
};

/**
 * Classic token bucket: refill proportionally to elapsed time, capped at capacity.
 * One successful `tryTake` consumes one token (or `cost`).
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, BucketState>();
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly nowMs: NowMsFn;

  constructor(config: TokenBucketConfig, nowMs: NowMsFn = () => Date.now()) {
    this.capacity = config.capacity;
    this.refillPerSecond = config.refillPerSecond;
    this.nowMs = nowMs;
  }

  /** Returns true when a token was consumed; false when over limit. */
  tryTake(key: string, cost = 1): boolean {
    if (cost <= 0) {
      return true;
    }
    const now = this.nowMs();
    let state = this.buckets.get(key);
    if (!state) {
      state = { tokens: this.capacity, lastRefillMs: now };
      this.buckets.set(key, state);
    } else {
      this.refill(state, now);
    }

    if (state.tokens < cost) {
      return false;
    }
    state.tokens -= cost;
    return true;
  }

  /** Test helper — current token count after refill to `nowMs()`. */
  peekTokens(key: string): number {
    const now = this.nowMs();
    const state = this.buckets.get(key);
    if (!state) {
      return this.capacity;
    }
    this.refill(state, now);
    return state.tokens;
  }

  private refill(state: BucketState, nowMs: number): void {
    const elapsedMs = Math.max(0, nowMs - state.lastRefillMs);
    if (elapsedMs === 0) {
      return;
    }
    const added = (elapsedMs / 1000) * this.refillPerSecond;
    state.tokens = Math.min(this.capacity, state.tokens + added);
    state.lastRefillMs = nowMs;
  }
}

/** Limiter for inbound Socket.IO events that may be flooded. */
export class SocketRateLimiter {
  private readonly game: TokenBucketLimiter;
  private readonly chat: TokenBucketLimiter;
  private readonly roomCreate: TokenBucketLimiter;
  private readonly roomJoin: TokenBucketLimiter;
  private readonly sessionReconnect: TokenBucketLimiter;

  constructor(nowMs: NowMsFn = () => Date.now()) {
    this.game = new TokenBucketLimiter(GAME_ACTION_BUCKET, nowMs);
    this.chat = new TokenBucketLimiter(CHAT_SEND_BUCKET, nowMs);
    this.roomCreate = new TokenBucketLimiter(ROOM_CREATE_BUCKET, nowMs);
    this.roomJoin = new TokenBucketLimiter(ROOM_JOIN_BUCKET, nowMs);
    this.sessionReconnect = new TokenBucketLimiter(SESSION_RECONNECT_BUCKET, nowMs);
  }

  allowGameAction(socketId: string): boolean {
    return this.game.tryTake(socketId);
  }

  allowChatSend(socketId: string): boolean {
    return this.chat.tryTake(socketId);
  }

  allowRoomCreate(socketId: string): boolean {
    return this.roomCreate.tryTake(socketId);
  }

  allowRoomJoin(socketId: string): boolean {
    return this.roomJoin.tryTake(socketId);
  }

  allowSessionReconnect(socketId: string): boolean {
    return this.sessionReconnect.tryTake(socketId);
  }

  /** Test helper. */
  peekGameTokens(socketId: string): number {
    return this.game.peekTokens(socketId);
  }

  /** Test helper. */
  peekChatTokens(socketId: string): number {
    return this.chat.peekTokens(socketId);
  }

  /** Test helper. */
  peekRoomCreateTokens(socketId: string): number {
    return this.roomCreate.peekTokens(socketId);
  }
}
