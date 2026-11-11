import http from 'node:http';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { ClientEvents } from '@shaatir-shakuni/socket-api';
import type { Clock } from '@shaatir-shakuni/engine';
import { Orchestrator } from './orchestrator.js';
import { mountAdminRoutes } from './admin.js';
import type { PersistencePort } from './persist.js';
import { MemoryPersistence } from './memory-persistence.js';
import { createMonotonicClock } from './clock.js';
import { createIncidentLogger } from './freeze-log.js';
import { resolveCorsOriginConfig, toSocketIoCorsOrigin } from './cors.js';
import type { TimeoutConfig } from '@shaatir-shakuni/reconnect';

export type CreateServerOptions = {
  readonly persist?: PersistencePort;
  readonly clock?: Clock;
  readonly port?: number;
  /** Override CORS resolution (tests). Defaults to env-based policy. */
  readonly corsOrigin?: string | string[];
  /** Override admin token (tests). Defaults to `ADMIN_API_TOKEN` env. */
  readonly adminToken?: string | null;
  /** Override AFK / ceremony timers (bot harness / tests). */
  readonly timeouts?: TimeoutConfig;
};

export type CreatedServer = {
  readonly app: express.Express;
  readonly httpServer: http.Server;
  readonly io: SocketIOServer;
  readonly orch: Orchestrator;
  readonly persist: PersistencePort;
  start(): Promise<number>;
  stop(): Promise<void>;
};

export function createServer(opts: CreateServerOptions = {}): CreatedServer {
  const persist = opts.persist ?? new MemoryPersistence();
  const clock = opts.clock ?? createMonotonicClock();
  const memoryPersist = persist instanceof MemoryPersistence ? persist : undefined;

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      dbAvailable: persist.isAvailable(),
      protocol: 1,
    });
  });

  const corsOrigin =
    opts.corsOrigin ??
    toSocketIoCorsOrigin(resolveCorsOriginConfig(process.env));

  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: corsOrigin },
  });

  const emit = (socketId: string, event: string, payload: unknown): void => {
    io.to(socketId).emit(event, payload);
  };

  const orch = new Orchestrator({
    persist,
    clock,
    emit,
    incidents: createIncidentLogger(),
    memoryPersist,
    timeouts: opts.timeouts,
  });

  mountAdminRoutes(app, orch, persist, {
    adminToken: opts.adminToken,
  });

  io.on('connection', (socket) => {
    const forward = (eventName: string) => {
      socket.on(eventName, (raw: unknown) => {
        void orch.handleEvent(socket.id, eventName, raw);
      });
    };

    forward(ClientEvents.HELLO);
    forward(ClientEvents.ROOM_CREATE);
    forward(ClientEvents.ROOM_JOIN);
    forward(ClientEvents.ROOM_LEAVE);
    forward(ClientEvents.ROOM_START);
    forward(ClientEvents.ROOM_SET_REBALANCE);
    forward(ClientEvents.ROOM_PLAY_AGAIN);
    forward(ClientEvents.SESSION_RECONNECT);
    forward(ClientEvents.GAME_ACTION);
    forward(ClientEvents.CHAT_SEND);

    socket.on('disconnect', () => {
      void orch.handleDisconnect(socket.id);
    });
  });

  let listeningPort: number | null = null;

  return {
    app,
    httpServer,
    io,
    orch,
    persist,
    async start(): Promise<number> {
      const port = opts.port ?? Number(process.env['PORT'] ?? 3001);
      await new Promise<void>((resolve) => {
        httpServer.listen(port, () => resolve());
      });
      const addr = httpServer.address();
      listeningPort = typeof addr === 'object' && addr ? addr.port : port;
      return listeningPort;
    },
    async stop(): Promise<void> {
      orch.dispose();
      await new Promise<void>((resolve, reject) => {
        io.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
