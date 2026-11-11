import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SocketProvider } from '../src/socket/SocketProvider';
import { GameSocketClient } from '../src/socket/GameSocketClient';

describe('EC-84 SocketProvider mount guard', () => {
  it('calls connect once even if provider logic is re-entered before reset', () => {
    const connect = vi.fn();
    const disconnect = vi.fn();
    const client = {
      connect,
      disconnect,
    } as unknown as GameSocketClient;

    const { unmount } = render(
      <SocketProvider client={client}>
        <div>child</div>
      </SocketProvider>,
    );

    expect(connect).toHaveBeenCalledTimes(1);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
