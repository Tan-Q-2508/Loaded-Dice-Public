/**
 * EC-18: host reconnect after migration never auto-reclaims host.
 * Returns attachment metadata only; `hostPlayerId` is always unchanged.
 */

export interface ResolveHostOnReconnectInput {
  readonly roomHostPlayerId: string | null;
  readonly reconnectingPlayerId: string;
}

export interface ResolveHostOnReconnectResult {
  readonly playerId: string;
  /** Always the pre-existing room host — never mutated by reconnect. */
  readonly hostPlayerId: string | null;
  readonly isCurrentHost: boolean;
  /** Always false — reclaim requires an explicit lobby transfer action. */
  readonly reclaimedHost: false;
}

export function resolveHostOnReconnect(
  input: ResolveHostOnReconnectInput,
): ResolveHostOnReconnectResult {
  const hostPlayerId = input.roomHostPlayerId;
  return {
    playerId: input.reconnectingPlayerId,
    hostPlayerId,
    isCurrentHost:
      hostPlayerId !== null && hostPlayerId === input.reconnectingPlayerId,
    reclaimedHost: false,
  };
}
