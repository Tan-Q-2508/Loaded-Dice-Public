/**
 * EC-R01 — structured FREEZE / TERMINATE (CORRUPTED) logging for ops visibility.
 */

export type IncidentKind = 'FREEZE' | 'TERMINATE';

export type IncidentLogEntry = {
  readonly kind: IncidentKind;
  readonly roomId: string;
  readonly roomCode: string;
  readonly reason: string;
  readonly timestampMs: number;
  readonly lastKnownSnapshotVersion: number;
};

export type IncidentLogger = {
  log(entry: IncidentLogEntry): void;
  list(): readonly IncidentLogEntry[];
};

export function createIncidentLogger(
  sink: (entry: IncidentLogEntry) => void = (e) => {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: 'error',
        event: e.kind === 'FREEZE' ? 'room_frozen' : 'room_terminated',
        roomId: e.roomId,
        roomCode: e.roomCode,
        reason: e.reason,
        timestampMs: e.timestampMs,
        lastKnownSnapshotVersion: e.lastKnownSnapshotVersion,
      }),
    );
  },
): IncidentLogger {
  const entries: IncidentLogEntry[] = [];
  return {
    log(entry: IncidentLogEntry): void {
      entries.push(entry);
      sink(entry);
    },
    list(): readonly IncidentLogEntry[] {
      return entries;
    },
  };
}
