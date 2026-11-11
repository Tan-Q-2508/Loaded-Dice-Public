/**
 * EC-16: newest successful connection is writable; older sockets stay connected
 * but demoted to read-only (orchestration emits `session:read_only`).
 */

export interface RegisterWritableConnectionInput {
  readonly playerId: string;
  readonly newSocketId: string;
  readonly priorWritableSocketId: string | null;
}

export interface RegisterWritableConnectionResult {
  readonly playerId: string;
  readonly writableSocketId: string;
  /** Prior writable socket to demote, if any and different from the new one. */
  readonly demoteSocketId: string | null;
  readonly readOnlyReason: 'SUPERSEDED_BY_NEWER_CONNECTION' | null;
}

export function registerWritableConnection(
  input: RegisterWritableConnectionInput,
): RegisterWritableConnectionResult {
  const prior = input.priorWritableSocketId;
  const demote =
    prior !== null && prior !== input.newSocketId ? prior : null;

  return {
    playerId: input.playerId,
    writableSocketId: input.newSocketId,
    demoteSocketId: demote,
    readOnlyReason: demote !== null ? 'SUPERSEDED_BY_NEWER_CONNECTION' : null,
  };
}

export function isSocketWritable(
  socketId: string,
  writableSocketId: string | null,
): boolean {
  return writableSocketId !== null && socketId === writableSocketId;
}
