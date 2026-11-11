/** Lobby policy constants — binding; see DECISIONS.md (05-lobby). */

/** EC-02: host alone in LOBBY after disconnect — hold then delete. */
export const HOST_ALONE_GRACE_MS = 5 * 60_000;

/** EC-04 lobby half: empty LOBBY room idle → expire/delete. */
export const LOBBY_IDLE_MS = 5 * 60_000;

/** EC-01: room-code collision retries before abort. */
export const ROOM_CODE_MAX_RETRIES = 8;

/** Short human-shareable code length. */
export const ROOM_CODE_LENGTH = 6;

/** Alphabet: uppercase A–Z + digits (no ambiguous O/0/I/1 filtering in v1). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export const MIN_PLAYERS_TO_START = 5;
export const MAX_PLAYERS = 10;

/**
 * EC-89: no profanity filtering in v1 — display names are length/uniqueness gated only.
 * Documented decision; do not silently add a filter later without updating DECISIONS.md.
 */
export const PROFANITY_FILTERING_ENABLED = false;

/** Generic join failure — does not distinguish missing / expired / wrong code (EC-11). */
export const GENERIC_JOIN_REJECT_MESSAGE = 'Unable to join room';

export const ROOM_FULL_MESSAGE = 'Room is full';
export const GAME_ALREADY_STARTED_MESSAGE = 'Game already in progress';
export const DISPLAY_NAME_TAKEN_MESSAGE = 'Display name is already taken';
export const DISPLAY_NAME_INVALID_MESSAGE = 'Display name is invalid';
export const NOT_HOST_MESSAGE = 'Only the host can perform this action';
export const NOT_LOBBY_MESSAGE = 'Action only allowed while the room is in lobby';
export const BAD_PLAYER_COUNT_MESSAGE = 'Need between 5 and 10 players to start';
export const PLAYER_NOT_IN_ROOM_MESSAGE = 'Player is not in this room';
export const ROOM_CODE_RETRY_EXHAUSTED_MESSAGE =
  'Could not allocate a unique room code';
