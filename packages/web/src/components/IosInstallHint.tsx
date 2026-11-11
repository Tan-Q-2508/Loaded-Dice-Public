import { useState } from 'react';
import { dismissIosInstallHint, shouldShowIosInstallHint } from '../lib/ios-install';

export function IosInstallHint() {
  const [visible, setVisible] = useState(() => shouldShowIosInstallHint());

  if (!visible) return null;

  const onDismiss = () => {
    dismissIosInstallHint();
    setVisible(false);
  };

  return (
    <div
      role="status"
      data-testid="ios-install-hint"
      className="pointer-events-auto mx-auto max-w-md rounded-xl border border-brass-500/35 bg-ink-950/95 px-3 py-3 text-left shadow-table backdrop-blur-sm"
    >
      <p className="font-body text-xs leading-relaxed text-mist-200">
        This browser cannot go fullscreen. Use Share, then{' '}
        <span className="font-semibold text-brass-300">Add to Home Screen</span> for a
        fullscreen-equivalent launch.
      </p>
      <button
        type="button"
        data-testid="ios-install-hint-dismiss"
        onClick={onDismiss}
        className="mt-2 min-h-11 min-w-11 rounded-md border border-mist-300/25 px-3 font-body text-xs font-semibold text-mist-100"
      >
        Got it
      </button>
    </div>
  );
}
