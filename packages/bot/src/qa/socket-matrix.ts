import type { SocketGameRecord } from '@shaatir-shakuni/sim';
import { assignDistinctPolicies, type WirePolicyName } from '../policies.js';
import { Narrator, defaultLogFilePath } from '../harness/narrator.js';
import { runGame } from '../harness/run-game.js';
import { bootServer } from '../harness/server.js';
import { mulberry32 } from '../harness/rng.js';

export interface SocketQaMatrixOptions {
  readonly gamesPerCount?: number;
  readonly baseSeed?: number;
  readonly stallTimeoutMs?: number;
  /** Cap total wall time per game (ms). */
  readonly stallTimeoutPerGameMs?: number;
}

function assignPolicies(playerCount: number, seed: number, _index: number): WirePolicyName[] {
  void _index;
  return assignDistinctPolicies(playerCount, mulberry32(seed ^ 0xdeadbeef));
}

/**
 * Socket-layer matrix: playerCount 5–10 × N games, each on a fresh in-memory
 * server with chaos injection (reconnect, latency, duplicates, stale packets).
 */
export async function runSocketQaMatrix(
  opts: SocketQaMatrixOptions = {},
): Promise<SocketGameRecord[]> {
  const gamesPerCount = opts.gamesPerCount ?? 10;
  const baseSeed = opts.baseSeed ?? (Date.now() & 0xffffffff);
  const stallTimeoutMs = opts.stallTimeoutMs ?? 25_000;
  const logFile = defaultLogFilePath('qa-socket');
  const records: SocketGameRecord[] = [];
  let index = 0;

  const gameDeadlineMs = Math.max(stallTimeoutMs * 3, 90_000);

  for (let playerCount = 5; playerCount <= 10; playerCount += 1) {
    for (let g = 0; g < gamesPerCount; g += 1) {
      const seed = (baseSeed + index * 9973 + playerCount * 131) >>> 0;
      const policies = assignPolicies(playerCount, seed, index);
      const rebalanceEnabled = g % 2 === 1;
      // eslint-disable-next-line no-console
      console.log(
        `  … starting socket game ${index + 1} players=${playerCount} seed=${seed}`,
      );
      const server = await bootServer();
      const narrator = new Narrator({
        logFile,
        quiet: true,
        label: `[socket ${index + 1}]`,
      });
      try {
        const result = await Promise.race([
          runGame({
            url: server.url,
            memory: server.memory,
            playerCount,
            narrator,
            seed,
            speedMs: 0,
            stallTimeoutMs,
            rebalanceEnabled,
            policyAssignment: policies,
            chaosEnabled: true,
          }),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(
                new Error(
                  `Socket game exceeded outer deadline ${gameDeadlineMs}ms`,
                ),
              );
            }, gameDeadlineMs);
          }),
        ]);
        records.push({
          layer: 'socket',
          seed,
          playerCount,
          ok: result.ok,
          finalPhase: result.finalPhase,
          winner: result.winner,
          winReason: result.winReason,
          hardAnomalies: result.hardAnomalies,
          anomalies: result.anomalies,
          durationMs: result.durationMs,
          policies: result.policyAssignment,
          failureMessage:
            result.ok && result.hardAnomalies === 0
              ? undefined
              : narrator.summary(),
          chaosEvents: result.chaosEvents,
        });
      } catch (err) {
        records.push({
          layer: 'socket',
          seed,
          playerCount,
          ok: false,
          finalPhase: 'CRASH',
          hardAnomalies: 1,
          anomalies: 1,
          durationMs: 0,
          policies,
          failureMessage: err instanceof Error ? err.message : String(err),
          chaosEvents: [],
        });
      } finally {
        narrator.close();
        await server.stop();
      }
      index += 1;
    }
  }

  return records;
}
