import { describe, expect, it, vi } from 'vitest';
import { createNavTrap } from '../src/lib/nav-trap';

describe('EC-85 navigation trap', () => {
  it('arms beforeunload and re-pushes history on popstate', () => {
    const listeners = new Map<string, EventListener>();
    const pushState = vi.fn();
    const history = { pushState, state: { existing: true } };
    const win = {
      addEventListener: (type: string, fn: EventListener) => {
        listeners.set(type, fn);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
    };

    const trap = createNavTrap({
      history,
      win,
      message: 'Leave?',
    });
    trap.arm();
    expect(pushState).toHaveBeenCalled();
    expect(listeners.has('beforeunload')).toBe(true);
    expect(listeners.has('popstate')).toBe(true);

    const firstState = pushState.mock.calls[0]?.[0] as Record<string, unknown>;
    // Must not spread prior history.state (may contain non-cloneable junk).
    expect(firstState).toEqual({ shaatiNavTrap: 'shaatir-nav-trap' });
    expect(() => structuredClone(firstState)).not.toThrow();

    const pop = listeners.get('popstate');
    expect(pop).toBeTypeOf('function');
    pop?.(new Event('popstate'));
    expect(pushState.mock.calls.length).toBeGreaterThanOrEqual(2);

    trap.disarm();
    expect(listeners.size).toBe(0);
  });

  it('swallows pushState DataCloneError so arm() cannot blank React', () => {
    const pushState = vi.fn(() => {
      throw new DOMException('simulated', 'DataCloneError');
    });
    const history = { pushState, state: { bad: Symbol('x') } };
    const win = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    expect(() => createNavTrap({ history, win }).arm()).not.toThrow();
    expect(win.addEventListener).toHaveBeenCalled();
  });
});
