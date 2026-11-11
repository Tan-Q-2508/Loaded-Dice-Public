import { DEFAULT_TIMEOUTS, type TimeoutConfig } from '@shaatir-shakuni/reconnect';
import { createServer, MemoryPersistence } from '@shaatir-shakuni/server';

type CreatedServer = ReturnType<typeof createServer>;

export type BootedServer = {
  readonly url: string;
  readonly port: number;
  readonly created: CreatedServer;
  /** Same instance passed to `createServer` — used to read committed `GameEvent`s for narration. */
  readonly memory: MemoryPersistence;
  stop(): Promise<void>;
};

/** Fast table ceremonies for automated bot matches (production stays discussion-paced). */
const BOT_HARNESS_TIMEOUTS: TimeoutConfig = {
  roleRevealMs: 2_000,
  actionMs: 8_000,
  inProgressReconnectWindowMs: 15 * 60_000,
  discussionPreVoteMs: 40,
  ceremonyVoteRevealMs: 40,
  ceremonyDecreeMs: 30,
  softAfkMs: 20,
};

export type BootServerOptions = {
  /**
   * When true, use production `DEFAULT_TIMEOUTS` (discussion-paced ceremonies).
   * Default false keeps the fast harness windows for socket/unit smoke.
   */
  readonly productionTimeouts?: boolean;
  readonly timeouts?: TimeoutConfig;
};

/**
 * Boots a fully self-contained, in-memory (no `DATABASE_URL` needed) server
 * instance for bot matches. Never touches a real database — safe to run
 * repeatedly and to run many instances in parallel (each on its own OS-assigned
 * port via `port: 0`).
 */
export async function bootServer(opts: BootServerOptions = {}): Promise<BootedServer> {
  const memory = new MemoryPersistence();
  const timeouts = opts.timeouts
    ?? (opts.productionTimeouts ? DEFAULT_TIMEOUTS : BOT_HARNESS_TIMEOUTS);
  const created = createServer({
    persist: memory,
    port: 0,
    // Bots connect directly via socket.io-client (no browser), so CORS is moot,
    // but keep it permissive for this throwaway instance.
    corsOrigin: '*',
    adminToken: null,
    timeouts,
  });
  const port = await created.start();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    created,
    memory,
    async stop() {
      try {
        await created.stop();
      } catch (err) {
        // `io.close()` already tears down the underlying HTTP server, so the
        // explicit `httpServer.close()` inside `createServer().stop()` can
        // throw ERR_SERVER_NOT_RUNNING as a harmless double-close. Anything
        // else should still surface.
        const code = (err as { code?: string } | undefined)?.code;
        if (code !== 'ERR_SERVER_NOT_RUNNING') throw err;
      }
    },
  };
}
