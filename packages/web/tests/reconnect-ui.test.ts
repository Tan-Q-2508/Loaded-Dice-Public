import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClientEvents,
  PROTOCOL_VERSION,
  ServerEvents,
  type WirePlayerView,
} from '@shaatir-shakuni/socket-api';
import type { Socket } from 'socket.io-client';
import { GameSocketClient } from '../src/socket/GameSocketClient';
import { useGameStore } from '../src/store/gameStore';

type Handler = (...args: unknown[]) => void;

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

function baseView(overrides: Partial<WirePlayerView> = {}): WirePlayerView {
  return {
    roomId: '22222222-2222-4222-8222-222222222222',
    viewerId: '11111111-1111-4111-8111-111111111111',
    stateVersion: 4,
    protocolVersion: PROTOCOL_VERSION,
    phase: { kind: 'ELECTION_VOTING' },
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
    ...overrides,
  };
}

function createMockSocket() {
  const handlers = new Map<string, Handler>();
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const socket = {
    connected: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
      return socket;
    }),
    emit: vi.fn((event: string, payload: unknown) => {
      emitted.push({ event, payload });
    }),
  };
  return { socket: socket as unknown as Socket, handlers, emitted };
}

describe('client reconnect resync (EC-25 / EC-26 / EC-86)', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    useGameStore.getState().clearSession();
    useGameStore.setState({ nextSequence: 1, connectionPhase: 'idle' });
  });

  it('sets reconnecting on transport drop and does not clear view or pendingSelection', () => {
    const { socket, handlers } = createMockSocket();
    useGameStore.getState().applySession({
      authToken: 'tok',
      playerId: '11111111-1111-4111-8111-111111111111',
      roomId: '22222222-2222-4222-8222-222222222222',
      roomCode: 'ABCD',
    });
    useGameStore.getState().applyView(baseView());
    useGameStore.getState().setPendingSelection({
      phaseKind: 'ELECTION_VOTING',
      stateVersion: 4,
      kind: 'vote',
      value: 'HA',
    });
    useGameStore.getState().setReady();

    const client = new GameSocketClient({
      url: 'http://test',
      createSocket: () => socket,
    });
    client.connect();

    handlers.get('disconnect')!('transport close');

    expect(useGameStore.getState().connectionPhase).toBe('reconnecting');
    expect(useGameStore.getState().view?.stateVersion).toBe(4);
    expect(useGameStore.getState().pendingSelection?.value).toBe('HA');
  });

  it('does not enter reconnecting on intentional client disconnect', () => {
    const { socket, handlers } = createMockSocket();
    const client = new GameSocketClient({
      url: 'http://test',
      createSocket: () => socket,
    });
    client.connect();
    useGameStore.getState().setReady();
    client.disconnect();
    handlers.get('disconnect')?.('io client disconnect');
    expect(useGameStore.getState().connectionPhase).not.toBe('reconnecting');
  });

  it('re-emits session:reconnect after hello and clears reconnecting on state:sync', () => {
    const { socket, handlers, emitted } = createMockSocket();
    useGameStore.getState().applySession({
      authToken: 'tok',
      playerId: '11111111-1111-4111-8111-111111111111',
      roomId: '22222222-2222-4222-8222-222222222222',
      roomCode: 'ABCD',
    });
    useGameStore.getState().applyView(baseView());
    useGameStore.getState().setPendingSelection({
      phaseKind: 'ELECTION_VOTING',
      stateVersion: 4,
      kind: 'vote',
      value: 'HA',
    });

    const client = new GameSocketClient({
      url: 'http://test',
      createSocket: () => socket,
    });
    client.connect();
    handlers.get('disconnect')!('ping timeout');
    expect(useGameStore.getState().connectionPhase).toBe('reconnecting');

    handlers.get(ServerEvents.HELLO_OK)!({ protocolVersion: PROTOCOL_VERSION });
    expect(emitted.some((e) => e.event === ClientEvents.SESSION_RECONNECT)).toBe(true);
    expect(useGameStore.getState().connectionPhase).toBe('reconnecting');

    handlers.get(ServerEvents.STATE_SYNC)!({
      view: baseView(),
    });

    expect(useGameStore.getState().connectionPhase).toBe('ready');
    expect(useGameStore.getState().pendingSelection?.value).toBe('HA');
  });
});
