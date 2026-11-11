/**
 * GameEvents ledger helpers — seq gap detection (EC-98) and action UUID dedup (EC-83).
 */

export type SeqGap = {
  readonly afterSeq: number;
  readonly expectedNext: number;
  readonly foundNext: number;
};

export type SeqIntegrityResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly gaps: readonly SeqGap[] };

/** EC-98: detect gaps in a sorted ascending seq list for one room. */
export function detectSeqGaps(seqs: readonly number[]): SeqIntegrityResult {
  if (seqs.length === 0) return { ok: true };
  const sorted = [...seqs].sort((a, b) => a - b);
  const gaps: SeqGap[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur !== prev + 1) {
      gaps.push({ afterSeq: prev, expectedNext: prev + 1, foundNext: cur });
    }
  }
  return gaps.length === 0 ? { ok: true } : { ok: false, gaps };
}

/** Whether seq list starts at 1 (full-ledger expectation from game start). */
export function detectLeadingSeqGap(seqs: readonly number[]): boolean {
  if (seqs.length === 0) return false;
  const min = Math.min(...seqs);
  return min !== 1;
}

export type ActionUuidConflict = {
  readonly actionUuid: string;
  readonly existingSeq: number;
  readonly incomingSeq: number;
};

/**
 * EC-83: given already-persisted (actionUuid → seq) and an incoming append,
 * detect duplicate action UUID with a different seq (true ledger corruption /
 * dedup-layer bug). Same uuid + same seq is idempotent.
 */
export function detectActionUuidConflict(
  existingByUuid: ReadonlyMap<string, number>,
  actionUuid: string | null | undefined,
  incomingSeq: number,
): ActionUuidConflict | null {
  if (actionUuid === null || actionUuid === undefined) return null;
  const existingSeq = existingByUuid.get(actionUuid);
  if (existingSeq === undefined) return null;
  if (existingSeq === incomingSeq) return null;
  return { actionUuid, existingSeq, incomingSeq };
}

/** EC-91: host force-end is distinguishable via engine payload shape. */
export function isHostForceEndPayload(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return p['type'] === 'WIN_CONDITION_MET' && p['reason'] === 'HOST_FORCE_END';
}
