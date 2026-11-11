/**
 * Join distinct-personality bots to a human-hosted room and auto-act with think delays.
 *
 * Usage:
 *   npx tsx packages/bot/scripts/watch-ui-bots.ts <ROOM_CODE> [count] [--url URL] [--fast]
 *
 * Host creates the room in the browser first, then run this with the lobby code.
 */
import { io, type Socket } from 'socket.io-client';
import {
  ClientEvents,
  ServerEvents,
  PROTOCOL_VERSION,
  roomJoinedSchema,
  stateSyncSchema,
  stateUpdateSchema,
  actionRejectedSchema,
  type WirePlayerView,
} from '@shaatir-shakuni/socket-api';
import { randomUUID } from 'node:crypto';
import {
  assignDistinctPolicies,
  decideWireAction,
  thinkDelayMs,
  type WirePolicyName,
} from '../src/policies.js';
import { mulberry32 } from '../src/harness/rng.js';

function parseArgs(argv: readonly string[]): {
  code: string;
  count: number;
  url: string;
  fast: boolean;
} {
  let code = '';
  let count = 4;
  let url = process.env.SOCKET_URL ?? 'http://localhost:3001';
  let fast = false;
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--url') {
      url = argv[++i] ?? url;
    } else if (arg === '--fast') {
      fast = true;
    } else if (!arg.startsWith('--')) {
      positionals.push(arg);
    }
  }
  code = positionals[0] ?? '';
  if (positionals[1]) count = Number(positionals[1]);
  if (!code) {
    console.error(
      'Usage: watch-ui-bots.ts <ROOM_CODE> [count] [--url URL] [--fast]',
    );
    process.exit(1);
  }
  if (!Number.isInteger(count) || count < 1 || count > 9) {
    console.error('count must be 1–9 (host already occupies one seat)');
    process.exit(1);
  }
  return { code, count, url, fast };
}

type Client = {
  name: string;
  policy: WirePolicyName;
  socket: Socket;
  seq: number;
  playerId?: string;
  view?: WirePlayerView;
  lastActedKey?: string;
  acting: boolean;
  triedNominees: Set<string>;
  lastMaharajForTried: string | null;
  rng: () => number;
};

function envelope(payload: unknown, seq: number, stateVersion: number) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    actionUuid: randomUUID(),
    sequence: seq,
    stateVersion,
    payload,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function connect(
  name: string,
  policy: WirePolicyName,
  url: string,
  code: string,
  seed: number,
  thinkScale: number,
): Promise<Client> {
  const socket = io(url, { transports: ['websocket'] });
  const client: Client = {
    name,
    policy,
    socket,
    seq: 1,
    acting: false,
    triedNominees: new Set(),
    lastMaharajForTried: null,
    rng: mulberry32(seed),
  };

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${name} hello timeout`)), 15_000);
    socket.once(ServerEvents.HELLO_OK, () => {
      clearTimeout(t);
      resolve();
    });
    socket.on('connect_error', reject);
    socket.emit(ClientEvents.HELLO, { protocolVersion: PROTOCOL_VERSION });
  });

  const onView = (raw: unknown, label: 'sync' | 'update') => {
    const parsed = (label === 'sync' ? stateSyncSchema : stateUpdateSchema).safeParse(raw);
    if (!parsed.success) return;
    client.view = parsed.data.view;
    void maybeAct(client, thinkScale);
  };
  socket.on(ServerEvents.STATE_SYNC, (raw) => onView(raw, 'sync'));
  socket.on(ServerEvents.STATE_UPDATE, (raw) => onView(raw, 'update'));
  socket.on(ServerEvents.ACTION_REJECTED, (raw) => {
    const p = actionRejectedSchema.safeParse(raw);
    console.log(`[${name}] REJECT`, p.success ? p.data.code : raw);
    if (p.success && p.data.code === 'STATE_VERSION_MISMATCH') {
      client.lastActedKey = undefined;
      void maybeAct(client, thinkScale);
    }
  });

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${name} join timeout`)), 15_000);
    socket.once(ServerEvents.ROOM_JOINED, (raw) => {
      const p = roomJoinedSchema.parse(raw);
      client.playerId = p.playerId;
      console.log(`[${name}] joined ${p.playerId.slice(0, 8)} policy=${policy}`);
      clearTimeout(t);
      resolve();
    });
    socket.emit(
      ClientEvents.ROOM_JOIN,
      envelope({ roomCode: code, displayName: name }, client.seq++, 0),
    );
  });
  return client;
}

async function maybeAct(c: Client, thinkScale: number): Promise<void> {
  const v = c.view;
  if (!v || !c.playerId || c.acting) return;

  const maharaj = v.maharajCandidateId ?? null;
  if (maharaj !== c.lastMaharajForTried) {
    c.triedNominees.clear();
    c.lastMaharajForTried = maharaj;
  }

  const key = `${v.phase.kind}:${v.stateVersion}:${Boolean(v.votesRevealed || v.phase.votesRevealed)}`;
  if (c.lastActedKey === key) return;

  const decision = decideWireAction(
    {
      view: v,
      selfId: c.playerId,
      rng: c.rng,
      triedNominees: c.triedNominees,
    },
    c.policy,
  );

  if (decision.kind === 'none' || decision.kind === 'skip') return;

  if (
    decision.kind === 'action' &&
    decision.payload.type === 'NOMINATE_SENAPATI'
  ) {
    c.triedNominees.add(decision.payload.nomineeId);
  }

  c.acting = true;
  c.lastActedKey = key;
  try {
    const delay = thinkDelayMs(c.policy, c.rng, thinkScale);
    if (delay > 0) await sleep(delay);
    // Re-check view after think — state may have moved.
    const latest = c.view;
    if (!latest || !c.playerId) return;
    const again = decideWireAction(
      {
        view: latest,
        selfId: c.playerId,
        rng: c.rng,
        triedNominees: c.triedNominees,
      },
      c.policy,
    );
    if (again.kind !== 'action' && again.kind !== 'illegal') return;
    const payload = again.payload;
    const seq = c.seq++;
    const sv = latest.stateVersion;
    console.log(`[${c.name}/${c.policy}] ${payload.type} sv=${sv}`);
    c.socket.emit(ClientEvents.GAME_ACTION, envelope(payload, seq, sv));
  } finally {
    c.acting = false;
  }
}

const args = parseArgs(process.argv.slice(2));

async function main() {
  console.log(
    `watch-ui-bots url=${args.url} code=${args.code} count=${args.count} fast=${args.fast}`,
  );
  console.log('Create/host the room in the browser, then start when seats are full.');
  const rng = mulberry32(Date.now() >>> 0);
  const policies = assignDistinctPolicies(args.count, rng);
  const thinkScale = args.fast ? 0.15 : 1;
  const bots = await Promise.all(
    policies.map((policy, i) =>
      connect(
        `Bot-${policy}`,
        policy,
        args.url,
        args.code,
        (Date.now() + i * 9973) >>> 0,
        thinkScale,
      ),
    ),
  );
  console.log(
    `bots ready: ${bots.map((b) => `${b.name}`).join(', ')} — start the game as host`,
  );

  const start = Date.now();
  while (Date.now() - start < 45 * 60_000) {
    await sleep(2_000);
    const phase = bots[0]?.view?.phase.kind;
    if (phase === 'GAME_OVER') {
      console.log('GAME_OVER — disconnecting bots');
      break;
    }
  }
  for (const b of bots) b.socket.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
