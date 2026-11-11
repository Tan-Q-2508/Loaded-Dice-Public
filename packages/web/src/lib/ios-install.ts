import { isFullscreenApiAvailable } from './fullscreen';

export const IOS_INSTALL_HINT_KEY = 'shaatir.iosInstallHintDismissed';

type StandaloneNavigator = Navigator & { standalone?: boolean };

export function isIosPhoneSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPod/.test(navigator.userAgent);
}

/** iPhone/iPod Safari has no Fullscreen API; iPad Safari does. */
export function isIosSafariWithoutFullscreen(): boolean {
  return isIosPhoneSafari() && !isFullscreenApiAvailable();
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const nav = navigator as StandaloneNavigator;
  return (
    window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
  );
}

export function shouldShowIosInstallHint(): boolean {
  if (!isIosSafariWithoutFullscreen() || isStandaloneDisplay()) return false;
  try {
    return localStorage.getItem(IOS_INSTALL_HINT_KEY) !== '1';
  } catch {
    return true;
  }
}

export function dismissIosInstallHint(): void {
  try {
    localStorage.setItem(IOS_INSTALL_HINT_KEY, '1');
  } catch {
    // ignore quota / private mode
  }
}
