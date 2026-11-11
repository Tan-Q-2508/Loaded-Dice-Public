/**
 * Default timeouts for reconnect / AFK / table ceremonies
 * (logged in DECISIONS.md — 04-reconnect / board experience / fragment 19).
 * Absolute deadlines = windowStartedAtMs + these durations (EC-29-aligned).
 */
export type TimeoutConfig = {
  readonly roleRevealMs: number;
  readonly actionMs: number;
  readonly inProgressReconnectWindowMs: number;
  /** Pre-vote discussion hold after nomination. */
  readonly discussionPreVoteMs: number;
  /** Public vote-reveal hold before RESOLVE_ELECTION. */
  readonly ceremonyVoteRevealMs: number;
  /** Public decree-placement hold before ADVANCE_AFTER_DECREE. */
  readonly ceremonyDecreeMs: number;
  /**
   * Soft AFK mark window for multi-seat phases (disconnected seats become
   * deferred). Hard deadline remains the full phase duration above.
   * Solo-actor phases ignore soft and act at `actionMs`.
   */
  readonly softAfkMs: number;
};

export const DEFAULT_TIMEOUTS: TimeoutConfig = {
  /** Spec Section 5.2 default role-reveal ack window. */
  roleRevealMs: 15_000,
  /**
   * Required-action window for nomination, voting, legislation, and executive
   * (EC-39 and peers). Fragment 19: 90s so nomination feels discussable.
   */
  actionMs: 90_000,
  /** EC-04: preserve IN_PROGRESS rooms with zero sockets this long. */
  inProgressReconnectWindowMs: 15 * 60_000,
  /** Table discussion after Senapati nominated. */
  discussionPreVoteMs: 45_000,
  /** Table ceremony — ballots face-up before government resolves. */
  ceremonyVoteRevealMs: 30_000,
  /** Table ceremony — enacted decree visible on the track. */
  ceremonyDecreeMs: 30_000,
  /** Soft AFK: mark disconnected seats deferred before hard deadline. */
  softAfkMs: 20_000,
};
