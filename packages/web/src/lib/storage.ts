const AUTH_TOKEN_KEY = 'shaatir.authToken';
const ROOM_CODE_KEY = 'shaatir.roomCode';
const PLAYER_ID_KEY = 'shaatir.playerId';
const ROOM_ID_KEY = 'shaatir.roomId';

export type PersistedSession = {
  readonly authToken: string;
  readonly roomCode: string | null;
  readonly playerId: string | null;
  readonly roomId: string | null;
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore quota / private mode
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function loadAuthToken(): string | null {
  return read(AUTH_TOKEN_KEY);
}

export function loadPersistedSession(): PersistedSession | null {
  const authToken = read(AUTH_TOKEN_KEY);
  if (!authToken) return null;
  return {
    authToken,
    roomCode: read(ROOM_CODE_KEY),
    playerId: read(PLAYER_ID_KEY),
    roomId: read(ROOM_ID_KEY),
  };
}

export function saveSession(session: {
  readonly authToken: string;
  readonly roomCode: string;
  readonly playerId: string;
  readonly roomId: string;
}): void {
  write(AUTH_TOKEN_KEY, session.authToken);
  write(ROOM_CODE_KEY, session.roomCode);
  write(PLAYER_ID_KEY, session.playerId);
  write(ROOM_ID_KEY, session.roomId);
}

/** EC-13 — replace persisted token after reconnect rotation. */
export function saveAuthToken(authToken: string): void {
  write(AUTH_TOKEN_KEY, authToken);
}

export function clearAuthToken(): void {
  remove(AUTH_TOKEN_KEY);
  remove(ROOM_CODE_KEY);
  remove(PLAYER_ID_KEY);
  remove(ROOM_ID_KEY);
}
