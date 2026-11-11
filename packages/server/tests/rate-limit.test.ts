import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  PROTOCOL_VERSION,
  ClientEvents,
  ServerEvents,
} from '@shaatir-shakuni/socket-api';
import { createTestMonotonicClock } from '../src/clock.js';
import { MemoryPersistence } from '../src/memory-persistence.js';
import { Orchestrator } from '../src/orchestrator.js';
import { createIncidentLogger } from '../src/freeze-log.js';
import {
  TokenBucketLimiter,
  GAME_ACTION_BUCKET,
  CHAT_SEND_BUCKET,
  RATE_LIMITED_MESSAGE,
} from '../src/rate-limit.js';

type Emission = { socketId: string; event: string; payload: unknown };

function envelope(
  payload: unknown,
  overrides: Partial<{
    actionUuid: string;
    sequence: number;
    stateVersion: number;
  }> = {},
) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    actionUuid: overrides.actionUuid ?? randomUUID(),
    sequence: overrides.sequence ?? 1,
    stateVersion: overrides.stateVersion ?? 0,
    payload,
  };
}

function createOrch(clock = createTestMonotonicClock(0)) {
  const emissions: Emission[] = [];
  const persist = new MemoryPersistence();
  const orch = new Orchestrator({
    persist,
    clock,
    emit: (socketId, event, payload) => {
      emissions.push({ socketId, event, payload });
    },
    memoryPersist: persist,
    incidents: createIncidentLogger(() => undefined),
  });
  return { orch, emissions, persist, clock };
}

async function createRoom(orch: Orchestrator, emissions: Emission[], socketId = 'sock-1') {
  await orch.handleEvent(
    socketId,
    ClientEvents.ROOM_CREATE,
    envelope({ displayName: 'Hosty' }),
  );
  const created = emissions.find((e) => e.event === ServerEvents.ROOM_CREATED);
  expect(created).toBeDefined();
  const payload = created!.payload as {
    roomId: string;
    roomCode: string;
    authToken: string;
    playerId: string;
  };
  return payload;
}

function rejectCodes(emissions: Emission[]): string[] {
  return emissions
    .filter((e) => e.event === ServerEvents.ACTION_REJECTED)
    .map((e) => (e.payload as { code: string }).code);
}

describe('TokenBucketLimiter', () => {
  it('allows up to capacity then denies until refill', () => {
    let now = 0;
    const limiter = new TokenBucketLimiter(GAME_ACTION_BUCKET, () => now);

    for (let i = 0; i < 10; i++) {
      expect(limiter.tryTake('s1')).toBe(true);
    }
    expect(limiter.tryTake('s1')).toBe(false);

    // Refill 5/sec → 200ms adds 1 token
    now = 200;
    expect(limiter.tryTake('s1')).toBe(true);
    expect(limiter.tryTake('s1')).toBe(false);
  });

  it('keys buckets independently per socket id', () => {
    const limiter = new TokenBucketLimiter(CHAT_SEND_BUCKET, () => 0);
    for (let i = 0; i < 5; i++) {
      expect(limiter.tryTake('a')).toBe(true);
    }
    expect(limiter.tryTake('a')).toBe(false);
    expect(limiter.tryTake('b')).toBe(true);
  });

  it('caps tokens at capacity after long idle', () => {
    let now = 0;
    const limiter = new TokenBucketLimiter(CHAT_SEND_BUCKET, () => now);
    expect(limiter.tryTake('s')).toBe(true);
    now = 60_000;
    expect(limiter.peekTokens('s')).toBe(5);
  });
});

describe('Rate limiting (EC-128 / EC-129 / EC-130)', () => {
  it('EC-128: rapid game:action spam → RATE_LIMITED; limited attempt applies nothing, does not advance seq/dedup', async () => {
    const { orch, emissions, clock } = createOrch();
    const room = await createRoom(orch, emissions);
    const runtime = orch.registry.get(room.roomId)!;
    const binding = runtime.sockets.get('sock-1')!;
    const seqBefore = binding.expectedSequence;
    const stateVersionBefore = runtime.gameState?.stateVersion ?? 0;

    emissions.length = 0;
    const uuids: string[] = [];

    for (let i = 0; i < 11; i++) {
      const actionUuid = randomUUID();
      uuids.push(actionUuid);
      await orch.handleEvent(
        'sock-1',
        ClientEvents.GAME_ACTION,
        envelope(
          { type: 'ACK_ROLE_REVEAL' },
          { actionUuid, sequence: seqBefore + i, stateVersion: stateVersionBefore },
        ),
      );
    }

    const codes = rejectCodes(emissions);
    expect(codes.filter((c) => c === 'RATE_LIMITED')).toHaveLength(1);
    const limited = emissions.find(
      (e) =>
        e.event === ServerEvents.ACTION_REJECTED &&
        (e.payload as { code: string }).code === 'RATE_LIMITED',
    );
    expect(limited).toBeDefined();
    expect((limited!.payload as { message: string }).message).toBe(RATE_LIMITED_MESSAGE);

    // The rate-limited (11th) attempt never reaches the sequence guard at all, so it must
    // not apply engine state or advance seq/dedup. The 10 attempts that *do* pass the rate
    // limiter still advance `expectedSequence` (their envelopes were validated) even though
    // each is separately rejected by the engine for being submitted outside ROLE_REVEAL — see
    // DECISIONS.md 2026-08-07 "client sequence counter permanently desyncs": sequence tracks
    // envelope acceptance, not action legality, precisely so a single rejected action can't
    // permanently desync a client from `expectedSequence`.
    expect(runtime.gameState?.stateVersion).toBe(stateVersionBefore);
    expect(binding.expectedSequence).toBe(seqBefore + 10);
    const { checkActionDedup } = await import('@shaatir-shakuni/socket-api');
    for (const uuid of uuids) {
      expect(checkActionDedup(runtime.dedup, uuid).kind).toBe('NEW');
    }

    // Clock never advanced → still empty after 11 attempts at capacity 10
    expect(clock.now()).toBe(0);
    orch.dispose();
  });

  it('EC-129: rapid chat:send spam → RATE_LIMITED; no fan-out for limited messages', async () => {
    const { orch, emissions } = createOrch();
    const room = await createRoom(orch, emissions);
    const runtime = orch.registry.get(room.roomId)!;
    const binding = runtime.sockets.get('sock-1')!;
    let nextSeq = binding.expectedSequence;
    const stateVersion = runtime.gameState?.stateVersion ?? 0;
    emissions.length = 0;

    for (let i = 0; i < 6; i++) {
      await orch.handleEvent(
        'sock-1',
        ClientEvents.CHAT_SEND,
        envelope(
          { roomId: room.roomId, text: `msg-${i}` },
          { sequence: nextSeq, stateVersion },
        ),
      );
      // Successful chats advance expectedSequence; rate-limited ones do not.
      nextSeq = binding.expectedSequence;
    }

    const chats = emissions.filter((e) => e.event === ServerEvents.CHAT_MESSAGE);
    expect(chats).toHaveLength(5);
    expect(chats.map((e) => (e.payload as { text: string }).text)).toEqual([
      'msg-0',
      'msg-1',
      'msg-2',
      'msg-3',
      'msg-4',
    ]);

    const limited = emissions.filter(
      (e) =>
        e.event === ServerEvents.ACTION_REJECTED &&
        (e.payload as { code: string }).code === 'RATE_LIMITED',
    );
    expect(limited).toHaveLength(1);
    expect((limited[0]!.payload as { message: string }).message).toBe(RATE_LIMITED_MESSAGE);
    orch.dispose();
  });

  it('EC-130: rate check runs before queue.run — limited event never occupies writer', async () => {
    const { orch, emissions } = createOrch();
    const room = await createRoom(orch, emissions);
    emissions.length = 0;

    let queueEntries = 0;
    const origRun = orch.queue.run.bind(orch.queue);
    orch.queue.run = (<T,>(roomId: string, task: () => Promise<T>): Promise<T> => {
      queueEntries += 1;
      return origRun(roomId, task);
    }) as typeof orch.queue.run;

    // Exhaust game:action capacity (these do enter the queue)
    for (let i = 0; i < 10; i++) {
      await orch.handleEvent(
        'sock-1',
        ClientEvents.GAME_ACTION,
        envelope({ type: 'ACK_ROLE_REVEAL' }, { actionUuid: randomUUID() }),
      );
    }
    expect(queueEntries).toBe(10);

    // Hold the per-room writer
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocking = origRun(room.roomId, async () => {
      await held;
    });

    const before = queueEntries;
    const started = Date.now();
    await orch.handleEvent(
      'sock-1',
      ClientEvents.GAME_ACTION,
      envelope({ type: 'ACK_ROLE_REVEAL' }, { actionUuid: randomUUID() }),
    );
    const elapsedMs = Date.now() - started;

    expect(elapsedMs).toBeLessThan(100);
    expect(queueEntries).toBe(before);
    expect(
      emissions.some(
        (e) =>
          e.event === ServerEvents.ACTION_REJECTED &&
          (e.payload as { code: string }).code === 'RATE_LIMITED',
      ),
    ).toBe(true);

    release();
    await blocking;
    orch.dispose();
  });

  it('refills game:action tokens over time so traffic can resume', async () => {
    const { orch, emissions, clock } = createOrch();
    await createRoom(orch, emissions);
    emissions.length = 0;

    for (let i = 0; i < 10; i++) {
      await orch.handleEvent(
        'sock-1',
        ClientEvents.GAME_ACTION,
        envelope({ type: 'ACK_ROLE_REVEAL' }, { actionUuid: randomUUID() }),
      );
    }
    await orch.handleEvent(
      'sock-1',
      ClientEvents.GAME_ACTION,
      envelope({ type: 'ACK_ROLE_REVEAL' }, { actionUuid: randomUUID() }),
    );
    expect(rejectCodes(emissions).filter((c) => c === 'RATE_LIMITED')).toHaveLength(1);

    emissions.length = 0;
    clock.advance(200); // +1 token at 5/sec
    await orch.handleEvent(
      'sock-1',
      ClientEvents.GAME_ACTION,
      envelope({ type: 'ACK_ROLE_REVEAL' }, { actionUuid: randomUUID() }),
    );
    expect(rejectCodes(emissions).filter((c) => c === 'RATE_LIMITED')).toHaveLength(0);
    orch.dispose();
  });
});
