/**
 * EC-95 / EC-77 — optimistic snapshot versioning helpers (DB-agnostic).
 *
 * A write of version V is accepted only when no existing snapshot for the room
 * has version > V. Equal version is a no-op success (idempotent retry).
 * A write with version < existing max is rejected as stale.
 */

export type SnapshotVersionDecision =
  | { readonly ok: true; readonly kind: 'insert' | 'idempotent' }
  | { readonly ok: false; readonly kind: 'stale'; readonly existingMaxVersion: number };

export function decideSnapshotWrite(
  existingMaxVersion: number | null,
  incomingVersion: number,
): SnapshotVersionDecision {
  if (existingMaxVersion === null) {
    return { ok: true, kind: 'insert' };
  }
  if (incomingVersion === existingMaxVersion) {
    return { ok: true, kind: 'idempotent' };
  }
  if (incomingVersion > existingMaxVersion) {
    return { ok: true, kind: 'insert' };
  }
  return {
    ok: false,
    kind: 'stale',
    existingMaxVersion,
  };
}

/**
 * EC-77: when selecting a base snapshot for recovery against events that already
 * reach `latestEventStateVersion`, ignore snapshots newer than that watermark only
 * if they somehow exist without matching events — more commonly, ignore snapshots
 * whose version is *behind* already-applied in-memory state when comparing two
 * candidates. Prefer the highest version that is still ≤ `maxApplicableVersion`.
 */
export function selectSnapshotVersionForRecovery(
  availableVersions: readonly number[],
  maxApplicableVersion: number,
): number | null {
  let best: number | null = null;
  for (const v of availableVersions) {
    if (v > maxApplicableVersion) continue;
    if (best === null || v > best) best = v;
  }
  return best;
}
