/**
 * Last-resort recovery when React fails to paint (blank #root).
 * Clears stale session keys and offers a home escape hatch.
 */

const SESSION_KEYS = [
  'shaatir.authToken',
  'shaatir.roomCode',
  'shaatir.playerId',
  'shaatir.roomId',
] as const;

export function clearPersistedSessionKeys(): void {
  try {
    for (const key of SESSION_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // private mode / blocked storage
  }
}

function paintRecovery(root: HTMLElement, detail: string): void {
  root.innerHTML = `
    <main style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;font-family:system-ui,sans-serif;color:#f2ebe3;text-align:center;background:#14110f">
      <h1 style="font-size:1.5rem;margin:0 0 0.75rem">Could not load the game UI</h1>
      <p style="opacity:0.8;max-width:28rem;margin:0 0 1.5rem;line-height:1.5">${detail}</p>
      <a href="/" id="shaatir-recovery-home"
         style="display:inline-block;background:#c4922e;color:#14110f;font-weight:700;text-decoration:none;padding:0.75rem 1.25rem;border-radius:0.375rem">
        Clear session and go home
      </a>
    </main>
  `;
  const link = root.querySelector('#shaatir-recovery-home');
  link?.addEventListener('click', (event) => {
    event.preventDefault();
    clearPersistedSessionKeys();
    window.location.replace('/');
  });
}

/** Install global handlers + a delayed empty-root check. */
export function installBootRecovery(): void {
  const root = document.getElementById('root');
  if (!root) return;

  const show = (detail: string) => {
    clearPersistedSessionKeys();
    paintRecovery(root, detail);
  };

  window.addEventListener('error', (event) => {
    if (root.childElementCount === 0) {
      show(event.message || 'A script error cleared the page.');
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (root.childElementCount === 0) {
      show(String(event.reason ?? 'Unhandled promise rejection'));
    }
  });

  // If React never paints (or unmounts to empty), recover instead of infinite blank.
  window.setTimeout(() => {
    if (root.childElementCount === 0) {
      show('The page stayed blank after load. Your old session was cleared.');
    }
  }, 2500);
}
