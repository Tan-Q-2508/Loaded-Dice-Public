/**
 * EC-30 — display-only remaining time from authoritative wire fields.
 * Does not decide whether a deadline has passed for gameplay; server does.
 */
export function remainingAfkMs(
  afkDeadlineMs: number | null,
  serverNowMs: number,
  clientNowMs: number,
  syncedAtClientMs: number,
): number | null {
  if (afkDeadlineMs === null) return null;
  const estimatedServerNow = serverNowMs + (clientNowMs - syncedAtClientMs);
  return Math.max(0, afkDeadlineMs - estimatedServerNow);
}

export function formatRemainingMs(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
