import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IosInstallHint } from '../src/components/IosInstallHint';
import {
  IOS_INSTALL_HINT_KEY,
  dismissIosInstallHint,
  isIosSafariWithoutFullscreen,
  shouldShowIosInstallHint,
} from '../src/lib/ios-install';

function stripFullscreenApi(el: HTMLElement): void {
  Object.defineProperty(el, 'requestFullscreen', {
    value: undefined,
    configurable: true,
  });
  Object.defineProperty(el, 'webkitRequestFullscreen', {
    value: undefined,
    configurable: true,
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

function stubUserAgent(ua: string): void {
  Object.defineProperty(navigator, 'userAgent', {
    value: ua,
    configurable: true,
  });
}

function installMemoryLocalStorage(): void {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, String(value));
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
      clear: () => {
        map.clear();
      },
    },
    configurable: true,
  });
}

describe('iOS install hint', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    Object.defineProperty(window, 'matchMedia', {
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
      configurable: true,
    });
  });

  afterEach(() => {
    stubUserAgent(navigator.userAgent);
  });

  it('detects iPhone Safari without fullscreen as the A2HS case', () => {
    stubUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    );
    stripFullscreenApi(document.documentElement);
    expect(isIosSafariWithoutFullscreen()).toBe(true);
    expect(shouldShowIosInstallHint()).toBe(true);
  });

  it('does not treat desktop Chrome as the iOS fallback', () => {
    stubUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    expect(isIosSafariWithoutFullscreen()).toBe(false);
    expect(shouldShowIosInstallHint()).toBe(false);
  });

  it('persists dismiss so the hint is one-time', () => {
    stubUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    );
    stripFullscreenApi(document.documentElement);
    dismissIosInstallHint();
    expect(localStorage.getItem(IOS_INSTALL_HINT_KEY)).toBe('1');
    expect(shouldShowIosInstallHint()).toBe(false);
  });

  it('renders and dismisses the hint on iPhone Safari', () => {
    stubUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    );
    stripFullscreenApi(document.documentElement);

    render(<IosInstallHint />);
    expect(screen.getByTestId('ios-install-hint')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ios-install-hint-dismiss'));
    expect(screen.queryByTestId('ios-install-hint')).toBeNull();
  });
});
