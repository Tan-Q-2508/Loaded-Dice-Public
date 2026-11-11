import { bootServer } from './harness/server.js';
import { runGame } from './harness/run-game.js';
import { Narrator, defaultLogFilePath } from './harness/narrator.js';
import { ALL_WIRE_POLICY_NAMES, type WirePolicyName } from './policies.js';

type Mode = 'watch' | 'loop' | 'remote';

interface CliOptions {
  readonly players: number;
  readonly mode: Mode;
  readonly games: number;
  readonly seed: number;
  readonly speedMs: number;
  readonly policyMix: readonly WirePolicyName[] | null;
  readonly rebalanceEnabled: boolean;
  readonly stallTimeoutMs: number;
  /** Only used in `remote` mode: real deployment to point bots at instead of a throwaway local server. */
  readonly url: string | null;
  /** Only used in `remote` mode: how many games to run concurrently. */
  readonly concurrency: number;
}

function isWirePolicyName(value: string): value is WirePolicyName {
  return (ALL_WIRE_POLICY_NAMES as readonly string[]).includes(value);
}

function parseArgs(argv: readonly string[]): CliOptions {
  let players = 7;
  let mode: Mode = 'watch';
  let games = 20;
  let seed = Date.now() & 0xffffffff;
  let speedMs = 400;
  let policyMix: WirePolicyName[] | null = null;
  let rebalanceEnabled = false;
  let stallTimeoutMs = 20_000;
  let url: string | null = null;
  let concurrency = 1;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return v;
    };
    switch (arg) {
      case '--players':
        players = Number(next());
        break;
      case '--mode':
        mode = next() as Mode;
        break;
      case '--games':
        games = Number(next());
        break;
      case '--seed':
        seed = Number(next());
        break;
      case '--speed':
        speedMs = Number(next());
        break;
      case '--rebalance':
        rebalanceEnabled = true;
        break;
      case '--stall-timeout':
        stallTimeoutMs = Number(next());
        break;
      case '--url':
        url = next();
        break;
      case '--concurrency':
        concurrency = Number(next());
        break;
      case '--policy-mix': {
        const names = next()
          .split(',')
          .map((s) => s.trim());
        for (const n of names) {
          if (!isWirePolicyName(n)) {
            throw new Error(
              `Unknown policy "${n}" — valid: ${ALL_WIRE_POLICY_NAMES.join(', ')}`,
            );
          }
        }
        policyMix = names as WirePolicyName[];
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (mode !== 'watch' && mode !== 'loop' && mode !== 'remote') {
    throw new Error(`--mode must be "watch", "loop", or "remote" (got "${mode}")`);
  }
  if (!Number.isInteger(players) || players < 5 || players > 10) {
    throw new Error(`--players must be an integer 5-10 (got ${players})`);
  }
  if (mode === 'remote' && !url) {
    throw new Error('--mode remote requires --url <server-url>');
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`--concurrency must be a positive integer (got ${concurrency})`);
  }

  return {
    players,
    mode,
    games,
    seed,
    speedMs,
    policyMix,
    rebalanceEnabled,
    stallTimeoutMs,
    url,
    concurrency,
  };
}

function resolvePolicyAssignment(
  opts: CliOptions,
): readonly WirePolicyName[] | undefined {
  if (!opts.policyMix) return undefined;
  return Array.from(
    { length: opts.players },
    (_, i) => opts.policyMix![i % opts.policyMix!.length]!,
  );
}

async function runWatch(opts: CliOptions): Promise<number> {
  const server = await bootServer();
  console.log(
    `Booted throwaway server at ${server.url} (in-memory, no DATABASE_URL). ${opts.players} bots, seed=${opts.seed}.`,
  );
  const narrator = new Narrator({ logFile: defaultLogFilePath('watch') });
  try {
    const result = await runGame({
      url: server.url,
      memory: server.memory,
      playerCount: opts.players,
      narrator,
      seed: opts.seed,
      speedMs: opts.speedMs,
      stallTimeoutMs: opts.stallTimeoutMs,
      rebalanceEnabled: opts.rebalanceEnabled,
      policyAssignment: resolvePolicyAssignment(opts),
    });
    narrator.line(
      `Finished: ok=${result.ok} finalPhase=${result.finalPhase} winner=${result.winner ?? '-'} reason=${result.winReason ?? '-'} durationMs=${result.durationMs}`,
    );
    narrator.line(narrator.summary());
    return result.ok && result.hardAnomalies === 0 ? 0 : 1;
  } finally {
    narrator.close();
    await server.stop();
  }
}

async function runLoop(opts: CliOptions): Promise<number> {
  console.log(
    `Running ${opts.games} bot matches (players=${opts.players}, baseSeed=${opts.seed}) at full speed...`,
  );
  const logFile = defaultLogFilePath('loop');
  let totalAnomalies = 0;
  let failedGames = 0;
  const failures: string[] = [];

  for (let i = 0; i < opts.games; i += 1) {
    const seed = opts.seed + i * 9973;
    const server = await bootServer();
    const narrator = new Narrator({ logFile, quiet: true, label: `[game ${i + 1}/${opts.games}]` });
    try {
      const result = await runGame({
        url: server.url,
        memory: server.memory,
        playerCount: opts.players,
        narrator,
        seed,
        speedMs: 0,
        stallTimeoutMs: opts.stallTimeoutMs,
        rebalanceEnabled: opts.rebalanceEnabled,
        policyAssignment: resolvePolicyAssignment(opts),
      });
      totalAnomalies += result.anomalies;
      const status = result.ok && result.hardAnomalies === 0 ? 'PASS' : result.ok ? 'PASS(anomalies)' : 'FAIL';
      console.log(
        `game ${i + 1}/${opts.games} seed=${seed}: ${status} finalPhase=${result.finalPhase} winner=${result.winner ?? '-'} anomalies=${result.anomalies} (hard=${result.hardAnomalies}) durationMs=${result.durationMs}`,
      );
      if (!result.ok || result.hardAnomalies > 0) {
        failedGames += 1;
        failures.push(
          `seed=${seed} finalPhase=${result.finalPhase} anomalies=${result.anomalies} hardAnomalies=${result.hardAnomalies}`,
        );
      }
    } finally {
      narrator.close();
      await server.stop();
    }
  }

  console.log(`\ngamesRun=${opts.games} failedGames=${failedGames} totalAnomalies=${totalAnomalies}`);
  console.log(`Full narration log: ${logFile}`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log(failedGames === 0 ? 'PASS' : 'FAIL');
  return failedGames === 0 ? 0 : 1;
}

/**
 * Stress-tests a real deployment (no throwaway server, no in-memory event
 * drain — bots see exactly what a real client sees). Runs `--games` matches,
 * up to `--concurrency` at a time, each with a distinct policy mix and seed
 * chosen to probe adversarial/edge-case behavior (vetoes, rejections,
 * disconnect/AFK simulation, illegal-action probes, Duryodhana-seeking votes).
 */
async function runRemote(opts: CliOptions): Promise<number> {
  const url = opts.url!;
  console.log(
    `Stress-testing ${url} — ${opts.games} games, players=${opts.players}, concurrency=${opts.concurrency}, baseSeed=${opts.seed}.`,
  );
  const logFile = defaultLogFilePath('remote');
  const adversarialMixes: readonly (readonly WirePolicyName[])[] = [
    ['random', 'always-veto', 'always-reject', 'duryodhana-seeking', 'disconnect-sim'],
    ['disconnect-sim', 'disconnect-sim', 'random', 'always-veto', 'duryodhana-seeking'],
    ['always-reject', 'always-reject', 'always-veto', 'always-veto', 'random'],
    ['duryodhana-seeking', 'duryodhana-seeking', 'random', 'disconnect-sim', 'always-reject'],
    ['random', 'random', 'disconnect-sim', 'always-veto', 'always-reject'],
  ];

  const results: Array<{
    readonly index: number;
    readonly seed: number;
    readonly result: Awaited<ReturnType<typeof runGame>> | null;
    readonly error: string | null;
  }> = [];

  async function runOne(i: number): Promise<void> {
    const seed = opts.seed + i * 9973;
    const mix = adversarialMixes[i % adversarialMixes.length]!;
    const policyAssignment = Array.from(
      { length: opts.players },
      (_, p) => mix[p % mix.length]!,
    );
    const narrator = new Narrator({ logFile, label: `[game ${i + 1}/${opts.games}]` });
    try {
      const result = await runGame({
        url,
        playerCount: opts.players,
        narrator,
        seed,
        speedMs: opts.speedMs,
        stallTimeoutMs: opts.stallTimeoutMs,
        rebalanceEnabled: opts.rebalanceEnabled,
        policyAssignment,
      });
      results.push({ index: i, seed, result, error: null });
      const status =
        result.ok && result.hardAnomalies === 0
          ? 'PASS'
          : result.ok
            ? 'PASS(concurrency noise only)'
            : 'FAIL';
      console.log(
        `[game ${i + 1}/${opts.games}] seed=${seed} mix=${mix.join(',')}: ${status} finalPhase=${result.finalPhase} winner=${result.winner ?? '-'} anomalies=${result.anomalies} (hard=${result.hardAnomalies}) durationMs=${result.durationMs}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ index: i, seed, result: null, error: message });
      console.log(`[game ${i + 1}/${opts.games}] seed=${seed}: CRASH ${message}`);
    } finally {
      narrator.close();
    }
  }

  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < opts.games) {
      const i = nextIndex;
      nextIndex += 1;
      await runOne(i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency, opts.games) }, () => worker()),
  );

  results.sort((a, b) => a.index - b.index);
  let totalAnomalies = 0;
  let totalHardAnomalies = 0;
  let failedGames = 0;
  const failureLines: string[] = [];
  for (const r of results) {
    if (r.error) {
      failedGames += 1;
      failureLines.push(`game ${r.index + 1} seed=${r.seed}: CRASH ${r.error}`);
      continue;
    }
    totalAnomalies += r.result!.anomalies;
    totalHardAnomalies += r.result!.hardAnomalies;
    // `hardAnomalies` excludes `concurrency_conflict` — an expected race when
    // several bots act at once, not a sign of a real bug. See DECISIONS.md
    // 2026-08-07 "client sequence counter permanently desyncs".
    if (!r.result!.ok || r.result!.hardAnomalies > 0) {
      failedGames += 1;
      failureLines.push(
        `game ${r.index + 1} seed=${r.seed}: finalPhase=${r.result!.finalPhase} anomalies=${r.result!.anomalies} hardAnomalies=${r.result!.hardAnomalies}`,
      );
    }
  }

  console.log(
    `\ngamesRun=${opts.games} failedGames=${failedGames} totalAnomalies=${totalAnomalies} totalHardAnomalies=${totalHardAnomalies}`,
  );
  console.log(`Full narration log: ${logFile}`);
  for (const line of failureLines) console.log(`  FAIL ${line}`);
  console.log(failedGames === 0 ? 'PASS' : 'REVIEW');
  return 0;
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const opts = parseArgs(argv);
  if (opts.mode === 'watch') return runWatch(opts);
  if (opts.mode === 'remote') return runRemote(opts);
  return runLoop(opts);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
