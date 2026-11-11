import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientEvents, PROTOCOL_VERSION, ServerEvents } from '@shaatir-shakuni/socket-api';
import type { Socket } from 'socket.io-client';
import { GameSocketClient } from '../src/socket/GameSocketClient';
import { useGameStore } from '../src/store/gameStore';

type Handler = (...args: unknown[]) => void;

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

describe('GameSocketClient.sendGameAction', () => {
  beforeEach(() => {
    useGameStore.setState({
      connectionPhase: 'ready',
      connectionMessage: null,
      authToken: 'tok',
      playerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      roomId: '11111111-1111-1111-1111-111111111111',
      roomCode: 'ABC123',
      view: {
        roomId: '11111111-1111-1111-1111-111111111111',
        viewerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        stateVersion: 2,
        protocolVersion: PROTOCOL_VERSION,
        phase: { kind: 'ROLE_REVEAL', pendingAcks: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'] },
        players: [],
        hostPlayerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        rebalanceEnabled: false,
        ownRole: 'PANDAVA',
        ownTeam: 'PANDAVA',
        knownKauravas: [],
    knownDuryodhanaId: null,
        maharajCandidateId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
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
      },
      nextSequence: 1,
      lastError: null,
      readOnly: false,
      roomFrozen: null,
      pendingSelection: null,
      animationEpoch: 0,
      timerSyncedAtClientMs: null,
    });
  });

  it('emits enveloped game:action', () => {
    const { socket, emitted } = createMockSocket();
    const client = new GameSocketClient({
      url: 'http://test',
      createSocket: () => socket,
    });
    client.connect();
    client.sendGameAction({ type: 'ACK_ROLE_REVEAL' });
    const action = emitted.find((e) => e.event === ClientEvents.GAME_ACTION);
    expect(action).toBeDefined();
    const payload = action!.payload as {
      protocolVersion: number;
      actionUuid: string;
      sequence: number;
      stateVersion: number;
      payload: { type: string };
    };
    expect(payload.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(payload.stateVersion).toBe(2);
    expect(payload.payload.type).toBe('ACK_ROLE_REVEAL');
    expect(payload.actionUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('handles action:deduped silently and room:frozen', () => {
    const { socket, handlers } = createMockSocket();
    const client = new GameSocketClient({
      url: 'http://test',
      createSocket: () => socket,
    });
    client.connect();

    useGameStore.getState().setLastError('stale');
    handlers.get(ServerEvents.ACTION_DEDUPED)?.({
      actionUuid: '11111111-1111-4111-8111-111111111111',
    });
    expect(useGameStore.getState().lastError).toBeNull();

    handlers.get(ServerEvents.ROOM_FROZEN)?.({
      roomId: '11111111-1111-1111-1111-111111111111',
      reasonCategory: 'game_cannot_continue',
      mode: 'FROZEN',
    });
    expect(useGameStore.getState().roomFrozen?.mode).toBe('FROZEN');
  });
});
