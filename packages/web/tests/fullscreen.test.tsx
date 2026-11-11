import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { WirePlayerView } from '@shaatir-shakuni/socket-api';
import { FullscreenToggle } from '../src/components/FullscreenToggle';
import {
  APP_IMMERSIVE_CLASS,
  exitAppFullscreen,
  installImmersiveInputGuard,
  isCssImmersive,
  isFullscreen,
  isFullscreenApiAvailable,
  isFullscreenOffered,
  isToggleFullscreenActive,
  prefersCssImmersive,
  requestAppFullscreen,
} from '../src/lib/fullscreen';
import { useGameStore } from '../src/store/gameStore';

function gameView(kind: string): WirePlayerView {
  return { phase: { kind } } as WirePlayerView;
}

function stripFullscreenApi(el: HTMLElement): void {
  Object.defineProperty(el, 'requestFullscreen', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(el, 'webkitRequestFullscreen', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(document, 'fullscreenEnabled', {
    value: false,
    configurable: true,
  });
  Object.defineProperty(document, 'webkitFullscreenEnabled', {
    value: false,
    configurable: true,
  });
}

function stubCoarsePointer(coarse: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: coarse && query.includes('pointer: coarse'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

function clearNativeFullscreen(): void {
  Object.defineProperty(document, 'fullscreenElement', {
    value: null,
    configurable: true,
  });
  Object.defineProperty(document, 'webkitFullscreenElement', {
    value: null,
    configurable: true,
  });
}

describe('fullscreen util', () => {
  afterEach(() => {
    document.documentElement.classList.remove(APP_IMMERSIVE_CLASS);
    clearNativeFullscreen();
    useGameStore.setState({ view: null });
    vi.unstubAllGlobals();
  });

  it('offers fullscreen only after the match leaves the lobby', () => {
    expect(isFullscreenOffered(undefined)).toBe(false);
    expect(isFullscreenOffered(null)).toBe(false);
    expect(isFullscreenOffered('LOBBY')).toBe(false);
    expect(isFullscreenOffered('ROLE_REVEAL')).toBe(true);
    expect(isFullscreenOffered('ELECTION_NOMINATION')).toBe(true);
    expect(isFullscreenOffered('GAME_OVER')).toBe(true);
  });

  it('reports unavailable when no vendor method exists', () => {
    const el = document.documentElement as HTMLElement & {
      requestFullscreen?: unknown;
      webkitRequestFullscreen?: unknown;
    };
    stripFullscreenApi(el);
    expect(isFullscreenApiAvailable()).toBe(false);
  });

  it('dispatches requestFullscreen then webkit fallbacks', async () => {
    const el = document.documentElement as HTMLElement & {
      requestFullscreen?: () => Promise<void>;
      webkitRequestFullscreen?: () => Promise<void>;
    };
    const std = vi.fn(async () => undefined);
    Object.defineProperty(el, 'requestFullscreen', {
      value: std,
      configurable: true,
      writable: true,
    });
    await requestAppFullscreen();
    expect(std).toHaveBeenCalledTimes(1);

    Object.defineProperty(el, 'requestFullscreen', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const webkit = vi.fn(async () => undefined);
    Object.defineProperty(el, 'webkitRequestFullscreen', {
      value: webkit,
      configurable: true,
      writable: true,
    });
    await requestAppFullscreen();
    expect(webkit).toHaveBeenCalledTimes(1);
  });

  it('exits via exitFullscreen or webkitExitFullscreen', async () => {
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.documentElement,
      configurable: true,
    });
    const std = vi.fn(async () => undefined);
    Object.defineProperty(document, 'exitFullscreen', {
      value: std,
      configurable: true,
    });
    await exitAppFullscreen();
    expect(std).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'exitFullscreen', {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      configurable: true,
    });
    Object.defineProperty(document, 'webkitFullscreenElement', {
      value: document.documentElement,
      configurable: true,
    });
    const webkit = vi.fn(async () => undefined);
    Object.defineProperty(document, 'webkitExitFullscreen', {
      value: webkit,
      configurable: true,
    });
    await exitAppFullscreen();
    expect(webkit).toHaveBeenCalledTimes(1);
  });

  it('still calls requestFullscreen on coarse pointers (toggle must actually enter)', async () => {
    stubCoarsePointer(true);
    expect(prefersCssImmersive()).toBe(true);
    const std = vi.fn(async () => undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: std,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, 'fullscreenEnabled', {
      value: true,
      configurable: true,
    });
    await requestAppFullscreen();
    expect(std).toHaveBeenCalledTimes(1);
    expect(isCssImmersive()).toBe(true);
  });

  it('uses CSS immersive only when the Fullscreen API is missing', async () => {
    stubCoarsePointer(true);
    stripFullscreenApi(document.documentElement);
    await requestAppFullscreen();
    expect(isCssImmersive()).toBe(true);
    await exitAppFullscreen();
    expect(isCssImmersive()).toBe(false);
  });

  it('exits native fullscreen on press, then focuses on release so the keyboard can open', async () => {
    Object.defineProperty(document, 'webkitFullscreenElement', {
      value: null,
      configurable: true,
    });
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.documentElement,
      configurable: true,
    });
    const exit = vi.fn(async () => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        configurable: true,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    Object.defineProperty(document, 'exitFullscreen', {
      value: exit,
      configurable: true,
    });
    const enter = vi.fn(async () => undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: enter,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, 'fullscreenEnabled', {
      value: true,
      configurable: true,
    });

    const stop = installImmersiveInputGuard();
    input.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(enter).not.toHaveBeenCalled();
    expect(isCssImmersive()).toBe(true);

    input.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(document.activeElement).toBe(input);
    expect(enter).not.toHaveBeenCalled();
    expect(isFullscreen()).toBe(true);
    stop();
    input.remove();
  });

  it('resolves a label tap to the wrapped text field', async () => {
    const label = document.createElement('label');
    const caption = document.createElement('span');
    caption.textContent = 'Display name';
    const input = document.createElement('input');
    input.type = 'text';
    label.append(caption, input);
    document.body.appendChild(label);
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.documentElement,
      configurable: true,
    });
    const exit = vi.fn(async () => undefined);
    Object.defineProperty(document, 'exitFullscreen', {
      value: exit,
      configurable: true,
    });

    const stop = installImmersiveInputGuard();
    caption.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(exit).toHaveBeenCalledTimes(1);
    caption.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(document.activeElement).toBe(input);
    stop();
    label.remove();
  });

  it('offers enter again after native fullscreen drops while CSS immersive stays on', () => {
    document.documentElement.classList.add(APP_IMMERSIVE_CLASS);
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: async () => undefined,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, 'fullscreenEnabled', {
      value: true,
      configurable: true,
    });
    expect(isFullscreen()).toBe(true);
    expect(isToggleFullscreenActive()).toBe(false);
  });

  it('reads fullscreenElement or webkitFullscreenElement', () => {
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      configurable: true,
    });
    Object.defineProperty(document, 'webkitFullscreenElement', {
      value: document.body,
      configurable: true,
    });
    expect(isFullscreen()).toBe(true);
  });
});

describe('FullscreenToggle', () => {
  afterEach(() => {
    useGameStore.setState({ view: null });
  });

  it('hides the button on home and in the lobby even when the API exists', () => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: async () => undefined,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, 'fullscreenEnabled', {
      value: true,
      configurable: true,
    });
    act(() => {
      useGameStore.setState({ view: null });
    });
    const { rerender } = render(<FullscreenToggle />);
    expect(screen.queryByTestId('fullscreen-toggle')).toBeNull();
    act(() => {
      useGameStore.setState({ view: gameView('LOBBY') });
    });
    rerender(<FullscreenToggle />);
    expect(screen.queryByTestId('fullscreen-toggle')).toBeNull();
  });

  it('hides the button when the Fullscreen API is missing', () => {
    const el = document.documentElement as HTMLElement & {
      requestFullscreen?: unknown;
      webkitRequestFullscreen?: unknown;
    };
    stripFullscreenApi(el);
    act(() => {
      useGameStore.setState({ view: gameView('ROLE_REVEAL') });
    });
    render(<FullscreenToggle />);
    expect(screen.queryByTestId('fullscreen-toggle')).toBeNull();
  });

  it('calls requestFullscreen when the toggle is clicked in-game', async () => {
    act(() => {
      useGameStore.setState({ view: gameView('ROLE_REVEAL') });
    });
    clearNativeFullscreen();
    const std = vi.fn(async () => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: document.documentElement,
        configurable: true,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: std,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, 'fullscreenEnabled', {
      value: true,
      configurable: true,
    });
    render(<FullscreenToggle />);
    fireEvent.click(screen.getByTestId('fullscreen-toggle'));
    await Promise.resolve();
    expect(std).toHaveBeenCalledTimes(1);
    expect(isCssImmersive()).toBe(true);
  });
});
