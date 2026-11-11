/**
 * Local smoke: host creates a room, watch-style bots with distinct policies join,
 * host starts, bots play with think delays until GAME_OVER (production ceremonies).
 */
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import {
  ClientEvents,
  PROTOCOL_VERSION,
  ServerEvents,
  roomJoinedSchema,
  stateSyncSchema,
  stateUpdateSchema,
  type WirePlayerView,
} from '@shaatir-shakuni/socket-api';
import { BotClient } from '../src/harness/bot-client.js';
import { bootServer } from '../src/harness/server.js';
import { mulberry32 } from '../src/harness/rng.js';
import {
  assignDistinctPolicies,
  decideWireAction,
  thinkDelayMs,
  type WirePolicyName,
} from '../src/policies.js';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type Bot = {
  name: string;
  policy: WirePolicyName;
  socket: Socket;
  seq: number;
  playerId?: string;
  view?: WirePlayerView;
  lastKey?: string;
  acting: boolean;
  tried: Set<string>;
  lastMaharaj: string | null;
  rng: () => number;
};

async function main(): Promise<void> {
  const server = await bootServer({ productionTimeouts: true });
  const host = new BotClient(server.url, 'Host');
  await host.connect();
  const session = await host.createRoom(false);
  const code = session.roomCode;
  console.log('room', code, 'url', server.url);

  const count = 4;
  const policies = assignDistinctPolicies(count, mulberry32(42));
  const bots: Bot[] = [];

  for (let i = 0; i < count; i += 1) {
    const policy = policies[i]!;
    const socket = io(server.url, { transports: ['websocket'] });
    const bot: Bot = {
      name: `Bot-${policy}`,
      policy,
      socket,
      seq: 1,
      acting: false,
      tried: new Set(),
      lastMaharaj: null,
      rng: mulberry32(1000 + i),
    };
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('hello timeout')), 10_000);
      socket.once(ServerEvents.HELLO_OK, () => {
        clearTimeout(t);
        resolve();
      });
      socket.emit(ClientEvents.HELLO, { protocolVersion: PROTOCOL_VERSION });
    });
    const onView = (raw: unknown, schema: typeof stateSyncSchema) => {
      const p = schema.safeParse(raw);
      if (!p.success) return;
      bot.view = p.data.view;
      void tick(bot);
    };
    socket.on(ServerEvents.STATE_SYNC, (r) => onView(r, stateSyncSchema));
    socket.on(ServerEvents.STATE_UPDATE, (r) => onView(r, stateUpdateSchema));
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('join timeout')), 10_000);
      socket.once(ServerEvents.ROOM_JOINED, (raw) => {
        bot.playerId = roomJoinedSchema.parse(raw).playerId;
        clearTimeout(t);
        resolve();
      });
      socket.emit(ClientEvents.ROOM_JOIN, {
        protocolVersion: PROTOCOL_VERSION,
        actionUuid: randomUUID(),
        sequence: bot.seq++,
        stateVersion: 0,
        payload: { roomCode: code, displayName: bot.name },
      });
    });
    bots.push(bot);
    console.log('joined', bot.name);
  }

  async function tick(bot: Bot): Promise<void> {
    const v = bot.view;
    if (!v || !bot.playerId || bot.acting) return;
    if ((v.maharajCandidateId ?? null) !== bot.lastMaharaj) {
      bot.tried.clear();
      bot.lastMaharaj = v.maharajCandidateId ?? null;
    }
    const key = `${v.phase.kind}:${v.stateVersion}`;
    if (bot.lastKey === key) return;
    const d = decideWireAction(
      { view: v, selfId: bot.playerId, rng: bot.rng, triedNominees: bot.tried },
      bot.policy,
    );
    if (d.kind !== 'action' && d.kind !== 'illegal') return;
    if (d.kind === 'action' && d.payload.type === 'NOMINATE_SENAPATI') {
      bot.tried.add(d.payload.nomineeId);
    }
    bot.acting = true;
    bot.lastKey = key;
    try {
      await sleep(thinkDelayMs(bot.policy, bot.rng, 0.15));
      const latest = bot.view;
      if (!latest || !bot.playerId) return;
      const again = decideWireAction(
        {
          view: latest,
          selfId: bot.playerId,
          rng: bot.rng,
          triedNominees: bot.tried,
        },
        bot.policy,
      );
      if (again.kind !== 'action' && again.kind !== 'illegal') return;
      bot.socket.emit(ClientEvents.GAME_ACTION, {
        protocolVersion: PROTOCOL_VERSION,
        actionUuid: randomUUID(),
        sequence: bot.seq++,
        stateVersion: latest.stateVersion,
        payload: again.payload,
      });
    } finally {
      bot.acting = false;
    }
  }

  const hostPolicy: WirePolicyName = 'loyalist';
  const hostRng = mulberry32(7);
  const hostTried = new Set<string>();
  let hostLastKey = '';
  const hostAct = async () => {
    const v = host.view;
    const id = host.playerId;
    if (!v || !id || host.hasPendingAction) return;
    const key = `${v.phase.kind}:${v.stateVersion}`;
    if (key === hostLastKey) return;
    const d = decideWireAction(
      { view: v, selfId: id, rng: hostRng, triedNominees: hostTried },
      hostPolicy,
    );
    if (d.kind !== 'action') return;
    if (d.payload.type === 'NOMINATE_SENAPATI') hostTried.add(d.payload.nomineeId);
    hostLastKey = key;
    await sleep(thinkDelayMs(hostPolicy, hostRng, 0.15));
    host.sendGameAction(d.payload);
  };
  host.on('view', () => {
    void hostAct();
  });
  host.on('unblocked', () => {
    void hostAct();
  });

  host.startGame();
  console.log('started — waiting for GAME_OVER');
  const start = Date.now();
  while (Date.now() - start < 600_000) {
    await sleep(1000);
    void hostAct();
    const phase = host.view?.phase.kind ?? bots[0]?.view?.phase.kind;
    if (phase === 'GAME_OVER') {
      console.log('PASS smoke-watch-ui', Date.now() - start, 'ms');
      for (const b of bots) b.socket.disconnect();
      host.dropConnection();
      await server.stop();
      return;
    }
  }
  throw new Error('smoke-watch-ui timed out');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
