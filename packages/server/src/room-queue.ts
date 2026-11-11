/**
 * EC-94 — per-room single-writer queue.
 * No two mutations for the same roomId ever run concurrently on this process.
 * v1 assumes a single backend instance (see DECISIONS.md).
 */
export class RoomQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(roomId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(roomId) ?? Promise.resolve();
    const next = prev.then(
      () => task(),
      () => task(),
    );
    this.tails.set(
      roomId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  /** True when a room currently has a queued or running task (test helper). */
  hasPending(roomId: string): boolean {
    return this.tails.has(roomId);
  }
}
