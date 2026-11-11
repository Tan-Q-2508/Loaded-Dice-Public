import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBrowserQaMatrix } from './browser-matrix.js';

function parseArgs(argv: readonly string[]): {
  gamesPerCount: number;
  baseSeed: number;
  thinkScale: number;
  headless: boolean;
  gameTimeoutMs: number;
  outDir: string | undefined;
  players: number | undefined;
} {
  let gamesPerCount = 10;
  let baseSeed = Date.now() & 0xffffffff;
  let thinkScale = 1;
  let headless = true;
  let gameTimeoutMs = 12 * 60_000;
  let outDir: string | undefined;
  let players: number | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return v;
    };
    switch (arg) {
      case '--games-per-count':
        gamesPerCount = Number(next());
        break;
      case '--seed':
        baseSeed = Number(next()) >>> 0;
        break;
      case '--fast':
        thinkScale = 0.15;
        break;
      case '--headed':
        headless = false;
        break;
      case '--game-timeout':
        gameTimeoutMs = Number(next());
        break;
      case '--players':
        players = Number(next());
        break;
      case '--out':
        outDir = path.resolve(next());
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { gamesPerCount, baseSeed, thinkScale, headless, gameTimeoutMs, outDir, players };
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const opts = parseArgs(argv);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const rangeLabel = opts.players ? String(opts.players) : '5..10';
  const total =
    opts.gamesPerCount * (opts.players ? 1 : 6);
  console.log(
    `QA browser matrix: ${opts.gamesPerCount} × [${rangeLabel}] = ${total} games, seed=${opts.baseSeed}, thinkScale=${opts.thinkScale}`,
  );
  const records = await runBrowserQaMatrix({
    gamesPerCount: opts.gamesPerCount,
    baseSeed: opts.baseSeed,
    thinkScale: opts.thinkScale,
    headless: opts.headless,
    gameTimeoutMs: opts.gameTimeoutMs,
    players: opts.players,
    outDir:
      opts.outDir ??
      path.resolve(here, '../../../../qa-reports', `browser-${opts.baseSeed}`),
  });
  const failed = records.filter((r) => !r.ok);
  console.log(`\nbrowser: completed=${records.length - failed.length} failed=${failed.length}`);
  for (const f of failed) {
    console.log(
      `  FAIL players=${f.playerCount} seed=${f.seed} phase=${f.finalPhase} ${f.failureMessage ?? ''}`,
    );
  }
  console.log(failed.length === 0 ? 'PASS' : 'FAIL');
  return failed.length === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
