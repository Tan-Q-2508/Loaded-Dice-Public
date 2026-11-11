/**
 * EC-85 — UX safety net against accidental navigation away from an active game.
 * Not a security boundary.
 *
 * History state must be structured-cloneable. Never put Symbol/function values
 * in `pushState`, and never spread `history.state` (it may already contain
 * non-cloneable values from an older build — that blanked /game on refresh).
 */

const NAV_TRAP_MARKER = 'shaatir-nav-trap' as const;

export type NavTrapHandle = {
  readonly arm: () => void;
  readonly disarm: () => void;
};

export function createNavTrap(options?: {
  readonly message?: string;
  readonly history?: Pick<History, 'pushState' | 'state'>;
  readonly win?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}): NavTrapHandle {
  const message =
    options?.message ?? 'Leave the active game? Your seat stays reserved until reconnect timeout.';
  const history = options?.history ?? (typeof window !== 'undefined' ? window.history : null);
  const win = options?.win ?? (typeof window !== 'undefined' ? window : null);

  let armed = false;

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!armed) return;
    event.preventDefault();
    event.returnValue = message;
  };

  const pushTrapState = () => {
    if (!history) return;
    try {
      // Intentionally do NOT spread history.state — clone failures blank the app.
      history.pushState({ shaatiNavTrap: NAV_TRAP_MARKER }, '');
    } catch {
      // History trap is best-effort; beforeunload still covers refresh/close.
    }
  };

  const onPopState = () => {
    if (!armed || !history) return;
    // Re-push so back/forward does not leave the game view.
    pushTrapState();
  };

  return {
    arm() {
      if (armed || !win || !history) return;
      armed = true;
      pushTrapState();
      win.addEventListener('beforeunload', onBeforeUnload);
      win.addEventListener('popstate', onPopState);
    },
    disarm() {
      if (!armed || !win) return;
      armed = false;
      win.removeEventListener('beforeunload', onBeforeUnload);
      win.removeEventListener('popstate', onPopState);
    },
  };
}
