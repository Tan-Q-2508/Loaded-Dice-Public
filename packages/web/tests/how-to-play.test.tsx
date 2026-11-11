import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HowToPlayGuide } from '../src/components/HowToPlayGuide';

describe('HowToPlayGuide', () => {
  it('opens a comprehensive rules dialog from the How to play button', () => {
    render(<HowToPlayGuide />);

    expect(screen.queryByTestId('how-to-play-dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('how-to-play'));

    const dialog = screen.getByTestId('how-to-play-dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog.className).toMatch(/text-left/);
    expect(dialog.querySelectorAll('ul, ol').length).toBeGreaterThan(0);
    for (const list of dialog.querySelectorAll('ul, ol')) {
      expect(list.className).toMatch(/text-left|pl-/);
    }
    expect(screen.getByRole('heading', { name: /how to play loaded dice/i })).toBeInTheDocument();

    expect(screen.getByText(/5–10 players/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pandava victory' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kaurava victory' })).toBeInTheDocument();
    expect(screen.getByText(/the most recently elected Maharaj and Senapati/i)).toBeInTheDocument();
    expect(screen.getByText(/Divine Sight — investigate loyalty/i)).toBeInTheDocument();
    expect(screen.getByText(/Celestial Foresight — policy peek/i)).toBeInTheDocument();
    expect(screen.getByText(/Exile — execution/i)).toBeInTheDocument();
    expect(screen.getByText(/Three consecutive failed governments/i)).toBeInTheDocument();
    expect(screen.getByText(/Unlocked permanently once the 5th Adharma Decree/i)).toBeInTheDocument();
  });

  it('closes from the close button and from Escape', () => {
    render(<HowToPlayGuide />);
    fireEvent.click(screen.getByTestId('how-to-play'));
    expect(screen.getByTestId('how-to-play-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('how-to-play-close'));
    expect(screen.queryByTestId('how-to-play-dialog')).toBeNull();

    fireEvent.click(screen.getByTestId('how-to-play'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('how-to-play-dialog')).toBeNull();
  });
});
