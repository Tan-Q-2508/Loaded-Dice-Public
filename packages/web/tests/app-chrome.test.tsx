import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppChrome } from '../src/components/AppChrome';
import { useGameStore } from '../src/store/gameStore';

describe('AppChrome reconnect banner', () => {
  it('pins the fullscreen control to the viewport top-right', () => {
    act(() => {
      useGameStore.setState({ connectionPhase: 'ready' });
    });
    render(<AppChrome />);
    const chrome = screen.getByTestId('fullscreen-chrome');
    expect(chrome.className).toMatch(/fixed/);
    expect(chrome.className).toMatch(/right-/);
    expect(chrome.className).toMatch(/top-/);
    expect(chrome.className).toMatch(/z-\[100\]/);
  });

  it('shows Reconnecting… only while connectionPhase is reconnecting', () => {
    act(() => {
      useGameStore.setState({ connectionPhase: 'ready' });
    });
    const { rerender } = render(<AppChrome />);
    expect(screen.queryByTestId('reconnect-banner')).toBeNull();

    act(() => {
      useGameStore.setState({ connectionPhase: 'reconnecting' });
    });
    rerender(<AppChrome />);
    expect(screen.getByTestId('reconnect-banner')).toHaveTextContent('Reconnecting…');
  });
});

