import { useEffect, useState } from 'react';
import { formatRemainingMs, remainingAfkMs } from '../lib/afk-countdown';
import { useGameStore } from '../store/gameStore';

/** EC-30 — display-only countdown from wire timer fields. */
export function useAfkCountdown(): string | null {
  const afkDeadlineMs = useGameStore((s) => s.view?.afkDeadlineMs ?? null);
  const serverNowMs = useGameStore((s) => s.view?.serverNowMs ?? 0);
  const syncedAt = useGameStore((s) => s.timerSyncedAtClientMs);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (afkDeadlineMs === null || syncedAt === null) {
      setLabel(null);
      return;
    }

    const tick = () => {
      const rem = remainingAfkMs(afkDeadlineMs, serverNowMs, Date.now(), syncedAt);
      if (rem === null) {
        setLabel(null);
        return;
      }
      setLabel(formatRemainingMs(rem));
    };

    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [afkDeadlineMs, serverNowMs, syncedAt]);

  return label;
}
