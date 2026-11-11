import { describe, expect, it } from 'vitest';
import { bootServer } from '../src/harness/server.js';
import { runGame } from '../src/harness/run-game.js';
import { Narrator } from '../src/harness/narrator.js';

describe('bot match smoke test', () => {
  it('plays a full 5-player game to completion over real sockets with no unexpected anomalies', async () => {
    const server = await bootServer();
    const narrator = new Narrator({ quiet: true });
    try {
      const result = await runGame({
        url: server.url,
        memory: server.memory,
        playerCount: 5,
        narrator,
        seed: 12345,
        speedMs: 0,
        stallTimeoutMs: 15_000,
      });

      expect(['GAME_OVER', 'ROOM_FROZEN', 'ROOM_CORRUPTED']).toContain(result.finalPhase);
      expect(result.finalPhase).toBe('GAME_OVER');
      expect(result.ok).toBe(true);

      // Concurrency conflicts (several bots acting in the same instant) are
      // an expected side effect of real-time play, not a bug in the tool or
      // the server — everything else should never happen in a clean run.
      expect(result.hardAnomalies).toBe(0);
    } finally {
      narrator.close();
      await server.stop();
    }
  }, 30_000);
});
