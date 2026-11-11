import { useEffect, useState } from 'react';
import {
  exitAppFullscreen,
  isFullscreenApiAvailable,
  isFullscreenOffered,
  isToggleFullscreenActive,
  requestAppFullscreen,
  subscribeFullscreenChange,
} from '../lib/fullscreen';
import { isIosSafariWithoutFullscreen } from '../lib/ios-install';
import { useGameStore } from '../store/gameStore';

export function FullscreenToggle() {
  const inGame = useGameStore((s) => isFullscreenOffered(s.view?.phase.kind));
  const [available] = useState(
    () => !isIosSafariWithoutFullscreen() && isFullscreenApiAvailable(),
  );
  const [active, setActive] = useState(() => isToggleFullscreenActive());

  useEffect(() => {
    if (!available) return;
    return subscribeFullscreenChange(() => setActive(isToggleFullscreenActive()));
  }, [available]);

  useEffect(() => {
    if (!inGame) void exitAppFullscreen();
  }, [inGame]);

  if (!inGame || !available) return null;

  const onToggle = () => {
    void (active ? exitAppFullscreen() : requestAppFullscreen());
  };

  return (
    <button
      type="button"
      data-testid="fullscreen-toggle"
      aria-label={active ? 'Exit fullscreen' : 'Enter fullscreen'}
      aria-pressed={active}
      onClick={onToggle}
      className="pointer-events-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-brass-500/35 bg-ink-950/80 text-brass-300 shadow-seat backdrop-blur-sm transition hover:border-brass-400 hover:text-brass-300"
    >
      {active ? <ExitFullscreenIcon /> : <EnterFullscreenIcon />}
    </button>
  );
}

function EnterFullscreenIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 3H4v4M16 3h4v4M8 21H4v-4M16 21h4v-4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExitFullscreenIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 3v4H4M16 3v4h4M8 21v-4H4M16 21v-4h4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
