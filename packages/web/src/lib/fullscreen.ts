type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullScreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
};

type VirtualKeyboardNavigator = Navigator & {
  virtualKeyboard?: { overlaysContent: boolean; show?: () => void };
};

export const APP_IMMERSIVE_CLASS = 'app-immersive';
const IMMERSIVE_EVENT = 'app-immersive-change';

function doc(): FullscreenDocument | null {
  if (typeof document === 'undefined') return null;
  return document as FullscreenDocument;
}

function rootEl(): FullscreenElement | null {
  const d = doc();
  if (!d) return null;
  return d.documentElement as FullscreenElement;
}

export function prefersCssImmersive(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export function isFullscreenApiAvailable(): boolean {
  const el = rootEl();
  const d = doc();
  if (!el || !d) return false;
  return Boolean(
    el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.webkitRequestFullScreen ||
      d.fullscreenEnabled ||
      d.webkitFullscreenEnabled,
  );
}

export function isCssImmersive(): boolean {
  return Boolean(doc()?.documentElement.classList.contains(APP_IMMERSIVE_CLASS));
}

function isNativeFullscreen(): boolean {
  const d = doc();
  if (!d) return false;
  return Boolean(d.fullscreenElement || d.webkitFullscreenElement);
}

export function isFullscreen(): boolean {
  return isNativeFullscreen() || isCssImmersive();
}

/** Home/lobby have text fields; offer fullscreen only after the match starts. */
export function isFullscreenOffered(phaseKind: string | null | undefined): boolean {
  return Boolean(phaseKind) && phaseKind !== 'LOBBY';
}

/** Toggle pressed state: native fullscreen, or CSS-only when the API is missing. */
export function isToggleFullscreenActive(): boolean {
  if (isNativeFullscreen()) return true;
  if (isFullscreenApiAvailable()) return false;
  return isCssImmersive();
}

function setCssImmersive(on: boolean): void {
  const d = doc();
  if (!d) return;
  d.documentElement.classList.toggle(APP_IMMERSIVE_CLASS, on);
  d.dispatchEvent(new Event(IMMERSIVE_EVENT));
}

export function enableOverlayKeyboard(): void {
  if (typeof navigator === 'undefined') return;
  const vk = (navigator as VirtualKeyboardNavigator).virtualKeyboard;
  if (vk) vk.overlaysContent = true;
}

function showVirtualKeyboard(el: HTMLElement): void {
  el.focus();
  const vk = (navigator as VirtualKeyboardNavigator).virtualKeyboard;
  vk?.show?.();
}

async function requestNativeFullscreen(el: FullscreenElement): Promise<void> {
  if (el.requestFullscreen) {
    await el.requestFullscreen();
    return;
  }
  if (el.webkitRequestFullscreen) {
    await el.webkitRequestFullscreen();
    return;
  }
  if (el.webkitRequestFullScreen) {
    await el.webkitRequestFullScreen();
  }
}

async function exitNativeFullscreen(): Promise<void> {
  const d = doc();
  if (!d || !isNativeFullscreen()) return;
  if (d.exitFullscreen) {
    await d.exitFullscreen();
    return;
  }
  if (d.webkitExitFullscreen) {
    await d.webkitExitFullscreen();
  }
}

/** Always prefer the Fullscreen API so the toggle actually enters fullscreen. */
export async function requestAppFullscreen(target?: HTMLElement): Promise<void> {
  enableOverlayKeyboard();
  // Companion class: if the browser later drops native fullscreen for the
  // keyboard, the toggle and layout stay in immersive mode.
  setCssImmersive(true);
  const el = (target ?? rootEl()) as FullscreenElement | null;
  if (el && isFullscreenApiAvailable()) {
    await requestNativeFullscreen(el);
  }
}

export async function exitAppFullscreen(): Promise<void> {
  if (isCssImmersive()) setCssImmersive(false);
  await exitNativeFullscreen();
}

export function subscribeFullscreenChange(listener: () => void): () => void {
  const d = doc();
  if (!d) return () => undefined;
  d.addEventListener('fullscreenchange', listener);
  d.addEventListener('webkitfullscreenchange', listener);
  d.addEventListener(IMMERSIVE_EVENT, listener);
  return () => {
    d.removeEventListener('fullscreenchange', listener);
    d.removeEventListener('webkitfullscreenchange', listener);
    d.removeEventListener(IMMERSIVE_EVENT, listener);
  };
}

export function isEditableField(node: EventTarget | null): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false;
  if (node instanceof HTMLInputElement) {
    const type = node.type;
    return type !== 'button' && type !== 'submit' && type !== 'checkbox' && type !== 'radio';
  }
  return (
    node instanceof HTMLTextAreaElement ||
    node instanceof HTMLSelectElement ||
    node.isContentEditable
  );
}

export function resolveEditableField(node: EventTarget | null): HTMLElement | null {
  if (isEditableField(node)) return node;
  if (!(node instanceof Element)) return null;
  const label = node.closest('label');
  if (!label) return null;
  const control = label.control;
  return isEditableField(control) ? control : null;
}

/**
 * Focusing a text field while native fullscreen is active makes mobile
 * browsers exit fullscreen and swallow the keyboard. Exit first, then
 * focus on pointerup (still a user gesture). Never re-enter here.
 */
export function installImmersiveInputGuard(): () => void {
  const d = doc();
  if (!d) return () => undefined;
  let pendingFocus: HTMLElement | null = null;
  let lastEditableGestureAt = 0;

  const onPress = (event: Event) => {
    const el = resolveEditableField(event.target);
    if (!el) return;
    pendingFocus = el;
    lastEditableGestureAt = Date.now();
    enableOverlayKeyboard();
    setCssImmersive(true);
    if (!isNativeFullscreen()) return;
    if (event.cancelable) event.preventDefault();
    void exitNativeFullscreen();
  };

  const onRelease = (event: Event) => {
    const el = pendingFocus;
    if (!el || Date.now() - lastEditableGestureAt > 2000) return;
    const from = resolveEditableField(event.target);
    if (from && from !== el) return;
    showVirtualKeyboard(el);
  };

  const onFullscreenChange = () => {
    if (isNativeFullscreen()) return;
    const el = pendingFocus;
    if (!el || Date.now() - lastEditableGestureAt > 2000) return;
    setCssImmersive(true);
    showVirtualKeyboard(el);
  };

  d.addEventListener('pointerdown', onPress, true);
  d.addEventListener('touchstart', onPress, { capture: true, passive: false });
  d.addEventListener('pointerup', onRelease, true);
  d.addEventListener('touchend', onRelease, { capture: true, passive: true });
  d.addEventListener('fullscreenchange', onFullscreenChange);
  d.addEventListener('webkitfullscreenchange', onFullscreenChange);
  return () => {
    d.removeEventListener('pointerdown', onPress, true);
    d.removeEventListener('touchstart', onPress, true);
    d.removeEventListener('pointerup', onRelease, true);
    d.removeEventListener('touchend', onRelease, true);
    d.removeEventListener('fullscreenchange', onFullscreenChange);
    d.removeEventListener('webkitfullscreenchange', onFullscreenChange);
  };
}
