export type LobbyConnectionStatus = 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING';

/** In-memory lobby membership shape (orchestration maps to/from DB rows). */
export interface LobbyPlayer {
  readonly id: string;
  readonly displayName: string;
  /** NFKC + casefold form used for uniqueness (EC-06/EC-07). */
  readonly normalizedDisplayName: string;
  readonly seatOrder: number;
  readonly connectionStatus: LobbyConnectionStatus;
  readonly joinedAt: number;
  readonly sessionId: string | null;
}

export interface LobbyRoom {
  readonly id: string;
  readonly roomCode: string;
  readonly hostPlayerId: string;
  /** DB room status string — lobby helpers treat only `LOBBY` as joinable for new players. */
  readonly status: string;
  readonly rebalanceEnabled: boolean;
  readonly players: readonly LobbyPlayer[];
  /**
   * When the sole host disconnected with nobody else in the room (EC-02).
   * Null/undefined when grace is not active.
   */
  readonly hostAloneGraceStartedAt: number | null;
  /**
   * When membership dropped to zero in LOBBY (EC-04).
   * Null/undefined when the room is not empty-idle tracking.
   */
  readonly emptySinceAt: number | null;
}

export type LobbyFailCode =
  | 'ROOM_CODE_RETRY_EXHAUSTED'
  | 'DISPLAY_NAME_INVALID'
  | 'DISPLAY_NAME_TAKEN'
  | 'ROOM_FULL'
  | 'ROOM_NOT_JOINABLE'
  | 'GAME_ALREADY_STARTED'
  | 'NOT_HOST'
  | 'NOT_LOBBY'
  | 'BAD_PLAYER_COUNT'
  | 'PLAYER_NOT_IN_ROOM';

export interface LobbyFail {
  readonly ok: false;
  readonly code: LobbyFailCode;
  readonly message: string;
}
