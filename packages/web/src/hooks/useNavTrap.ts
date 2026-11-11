import { useEffect } from 'react';
import { createNavTrap } from '../lib/nav-trap';

/** EC-85 — arm nav trap while an in-progress game view is mounted. */
export function useNavTrap(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const trap = createNavTrap();
    trap.arm();
    return () => trap.disarm();
  }, [active]);
}
