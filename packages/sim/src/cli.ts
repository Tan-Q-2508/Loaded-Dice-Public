import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSim } from './driver.js';

function parseArgs(argv: string[]): {
  games: number;
  baseSeed: number;
  maxSteps: number;
  persistRepro: boolean;
} {
  let games = 100;
  let baseSeed = 1;
  let maxSteps = 5000;
  let persistRepro = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if ((arg === '--games' || arg === '-n') && argv[i + 1]) {
      games = Number(argv[++i]);
    } else if (arg === '--seed' && argv[i + 1]) {
      baseSeed = Number(argv[++i]);
    } else if (arg === '--max-steps' && argv[i + 1]) {
      maxSteps = Number(argv[++i]);
    } else if (arg === '--no-persist') {
      persistRepro = false;
    } else if (arg.startsWith('--games=')) {
      games = Number(arg.slice('--games='.length));
    }
  }

  if (!Number.isFinite(games) || games < 1) {
    throw new Error(`Invalid --games value`);
  }
  return { games, baseSeed, maxSteps, persistRepro };
}

export function main(argv = process.argv.slice(2)): number {
  const opts = parseArgs(argv);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const failuresDir = path.resolve(here, '../failures');

  const envGames = process.env.SIM_GAMES;
  const games = envGames ? Number(envGames) : opts.games;

  console.log(
    `Loaded Dice sim: games=${games} baseSeed=${opts.baseSeed} maxSteps=${opts.maxSteps}`,
  );

  const summary = runSim({
    games,
    baseSeed: opts.baseSeed,
    maxSteps: opts.maxSteps,
    persistRepro: opts.persistRepro,
    failuresDir,
  });

  console.log(`gamesRun=${summary.gamesRun} failures=${summary.failures}`);
  for (const r of summary.results) {
    if (!r.ok) {
      console.log(
        `  FAIL seed=${r.seed} players=${r.playerCount} rebalance=${r.rebalanceEnabled} phase=${r.finalPhase} path=${r.reproPath ?? '(not persisted)'}`,
      );
      if (r.repro) {
        console.log(`    ${r.repro.failure.kind}: ${r.repro.failure.message}`);
      }
    }
  }

  if (summary.failures > 0) {
    console.log('FAIL');
    return 1;
  }
  console.log('PASS');
  return 0;
}

process.exitCode = main();
