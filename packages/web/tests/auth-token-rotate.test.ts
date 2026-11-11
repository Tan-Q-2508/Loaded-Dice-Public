import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROTOCOL_VERSION,
  ServerEvents,
  stateSyncSchema,
  type WirePlayerView,
} from '@shaatir-shakuni/socket-api';
import { useGameStore } from '../src/store/gameStore';
import { GameSocketClient } from '../src/socket/GameSocketClient';
import type { Socket } from 'socket.io-client';

function installMemoryLocalStorage(): void {
  const map = new Map<string, string>();
  const memory = {
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
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: memory,
    configurable: true,
  });
}

function baseView(): WirePlayerView {
  return {
    roomId: '22222222-2222-4222-8222-222222222222',
    viewerId: '11111111-1111-4111-8111-111111111111',
    stateVersion: 1,
    protocolVersion: PROTOCOL_VERSION,
    phase: { kind: 'ROLE_REVEAL', pendingAcks: ['11111111-1111-4111-8111-111111111111'] },
    players: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        displayName: 'Host',
        seatOrder: 0,
        isAlive: true,
        revealedRole: null,
      },
    ],
    hostPlayerId: '11111111-1111-4111-8111-111111111111',
    rebalanceEnabled: false,
    ownRole: 'PANDAVA',
    ownTeam: 'PANDAVA',
    knownKauravas: [],
    knownDuryodhanaId: null,
    maharajCandidateId: '11111111-1111-4111-8111-111111111111',
    senapatiCandidateId: null,
    currentGovernment: null,
    lastElectedGovernment: null,
    enactedDharma: 0,
    enactedAdharma: 0,
    electionTracker: 0,
    vetoUnlocked: false,
    heldTiles: [],
    drawnTilesForMaharaj: [],
    peekedTiles: [],
    ownInvestigations: [],
    votes: null,
    votesRevealed: false,
    startPlayerCount: 5,
    lastEnactedDecree: null,
    decreeDeckCount: 17,
    ashPileCount: 0,
    lastExiledPlayerId: null,
    winner: null,
    winReason: null,
    isSpectator: false,
    afkDeadlineMs: null,
    serverNowMs: 0,
    deferredAfkPlayerIds: [],
  };
}

describe('EC-13 rotated authToken on state:sync', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    useGameStore.getState().clearSession();
    useGameStore.setState({ nextSequence: 1 });
  });

  it('persists state:sync.authToken and replaces the previous token', () => {
    useGameStore.getState().applySession({
      authToken: 'old-token',
      playerId: '11111111-1111-4111-8111-111111111111',
      roomId: '22222222-2222-4222-8222-222222222222',
      roomCode: 'ABCD',
    });

    useGameStore.getState().applyRotatedAuthToken('new-token');

    expect(useGameStore.getState().authToken).toBe('new-token');
    expect(localStorage.getItem('shaatir.authToken')).toBe('new-token');
  });

  it('GameSocketClient applies rotated token from STATE_SYNC', () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const socket = {
      connected: true,
      connect: vi.fn(),
      disconnect: vi.fn(),
      removeAllListeners: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler);
        return socket;
      }),
      emit: vi.fn(),
    };

    useGameStore.getState().applySession({
      authToken: 'old-token',
      playerId: '11111111-1111-4111-8111-111111111111',
      roomId: '22222222-2222-4222-8222-222222222222',
      roomCode: 'ABCD',
    });

    const client = new GameSocketClient({
      url: 'http://test',
      createSocket: () => socket as unknown as Socket,
    });
    client.connect();

    const payload = {
      authToken: 'rotated-token',
      view: baseView(),
    };
    expect(stateSyncSchema.safeParse(payload).success).toBe(true);

    const sync = handlers.get(ServerEvents.STATE_SYNC);
    expect(sync).toBeTypeOf('function');
    sync!(payload);

    expect(useGameStore.getState().authToken).toBe('rotated-token');
    expect(localStorage.getItem('shaatir.authToken')).toBe('rotated-token');
  });
});
