import { createPortal } from 'react-dom';
import { useGameStore } from '../store/gameStore';
import { FullscreenToggle } from './FullscreenToggle';
import { IosInstallHint } from './IosInstallHint';

/**
 * Viewport-fixed chrome. Portaled to `document.body` so `#root` overflow/transform
 * cannot pull the fullscreen control into page flow (e.g. game-over scroll).
 */
export function AppChrome() {
  const phase = useGameStore((s) => s.connectionPhase);
  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        data-testid="fullscreen-chrome"
        className="pointer-events-none fixed right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-[100]"
      >
        <FullscreenToggle />
      </div>
      {phase === 'reconnecting' ? (
        <p
          role="status"
          data-testid="reconnect-banner"
          className="pointer-events-auto fixed left-[max(0.75rem,env(safe-area-inset-left))] top-[max(0.75rem,env(safe-area-inset-top))] z-[100] max-w-[min(18rem,calc(100vw-5.5rem))] rounded-lg border border-brass-500/30 bg-ink-950/90 px-3 py-2 font-body text-xs font-semibold text-brass-300 shadow-seat"
        >
          Reconnecting…
        </p>
      ) : null}
      <div className="pointer-events-none fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[100] flex justify-center px-3">
        <IosInstallHint />
      </div>
    </>,
    document.body,
  );
}
