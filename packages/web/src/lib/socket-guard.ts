/**
 * EC-84: ensure socket connection init runs at most once for a given mount lifecycle.
 * Uses a ref-like mutable flag (testable without React).
 */
export type SocketInitGuard = {
  readonly tryBegin: () => boolean;
  readonly reset: () => void;
  readonly hasStarted: () => boolean;
};

export function createSocketInitGuard(): SocketInitGuard {
  let started = false;
  return {
    tryBegin(): boolean {
      if (started) return false;
      started = true;
      return true;
    },
    reset(): void {
      started = false;
    },
    hasStarted(): boolean {
      return started;
    },
  };
}
