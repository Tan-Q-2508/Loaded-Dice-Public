/**
 * EC-19 / EC-20 / EC-83: action UUID deduplication.
 *
 * Orchestration owns persistence of the set (and DB unique constraint on
 * action_uuid). This helper is the in-memory / per-room check API.
 *
 * After a successful commit, call `remember`. Before applying, call `check`:
 * if already seen, treat as silent no-op (not an error).
 */

export interface ActionDedupStore {
  has(actionUuid: string): boolean;
  add(actionUuid: string): void;
}

export function createMemoryActionDedupStore(): ActionDedupStore {
  const seen = new Set<string>();
  return {
    has(actionUuid: string): boolean {
      return seen.has(actionUuid);
    },
    add(actionUuid: string): void {
      seen.add(actionUuid);
    },
  };
}

export type DedupCheckResult =
  | { readonly kind: 'NEW' }
  | { readonly kind: 'DUPLICATE' };

export function checkActionDedup(store: ActionDedupStore, actionUuid: string): DedupCheckResult {
  if (store.has(actionUuid)) {
    return { kind: 'DUPLICATE' };
  }
  return { kind: 'NEW' };
}

/** Call only after the action has successfully committed (engine + event write). */
export function rememberActionUuid(store: ActionDedupStore, actionUuid: string): void {
  store.add(actionUuid);
}
