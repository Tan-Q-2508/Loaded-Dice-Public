import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { createSocketInitGuard } from '../lib/socket-guard';
import { defaultSocketUrl, GameSocketClient } from './GameSocketClient';

const SocketContext = createContext<GameSocketClient | null>(null);

export type SocketProviderProps = {
  readonly children: ReactNode;
  readonly url?: string;
  readonly client?: GameSocketClient;
};

/**
 * EC-84: initializes the socket client exactly once per mount via a ref-guard.
 */
export function SocketProvider({ children, url, client: injected }: SocketProviderProps) {
  const client = useMemo(
    () => injected ?? new GameSocketClient({ url: url ?? defaultSocketUrl() }),
    [injected, url],
  );
  const guardRef = useRef(createSocketInitGuard());
  const clientRef = useRef(client);
  clientRef.current = client;

  useEffect(() => {
    const guard = guardRef.current;
    if (!guard.tryBegin()) {
      return;
    }
    clientRef.current.connect();
    return () => {
      clientRef.current.disconnect();
      guard.reset();
    };
  }, []);

  return <SocketContext.Provider value={client}>{children}</SocketContext.Provider>;
}

export function useGameSocket(): GameSocketClient {
  const client = useContext(SocketContext);
  if (!client) {
    throw new Error('useGameSocket must be used within SocketProvider');
  }
  return client;
}
