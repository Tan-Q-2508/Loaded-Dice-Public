import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runQaMatrix } from './qa-matrix.js';
import { writeQaReports } from './qa-reports.js';

function parseArgs(argv: readonly string[]): {
  gamesPerCount: number;
  baseSeed: number;
  maxSteps: number;
  outDir: string;
} {
  let gamesPerCount = 10;
  let baseSeed = Date.now() & 0xffffffff;
  let maxSteps = 8000;
  const here = path.dirname(fileURLToPath(import.meta.url));
  let outDir = path.resolve(here, '../../../');

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
      case '--max-steps':
        maxSteps = Number(next());
        break;
      case '--out':
        outDir = path.resolve(next());
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { gamesPerCount, baseSeed, maxSteps, outDir };
}

/**
 * Engine-only QA matrix. Prefer `npm run qa:stress` from the bot package
 * (or the repo root) for the combined engine + socket stress run.
 */
export function main(argv = process.argv.slice(2)): number {
  const opts = parseArgs(argv);
  console.log(
    `QA stress (engine): ${opts.gamesPerCount} games × playerCounts 5–10, baseSeed=${opts.baseSeed}`,
  );

  const engine = runQaMatrix({
    gamesPerCount: opts.gamesPerCount,
    baseSeed: opts.baseSeed,
    maxSteps: opts.maxSteps,
  });

  for (const r of engine.results) {
    const status = r.ok ? 'PASS' : `FAIL:${r.failureCategory}`;
    console.log(
      `  engine players=${r.playerCount} seed=${r.seed}: ${status} phase=${r.finalPhase} winner=${r.winner ?? '-'} steps=${r.steps}`,
    );
  }

  const paths = writeQaReports(opts.outDir, {
    engine,
    socket: [],
    generatedAt: new Date().toISOString(),
  });

  console.log(`\nReports written:`);
  console.log(`  ${paths.testReport}`);
  console.log(`  ${paths.bugReport}`);
  console.log(`  ${paths.failedSeeds}`);
  console.log(`  ${paths.testCoverage}`);
  console.log(
    `\nengine: completed=${engine.gamesCompleted} failed=${engine.gamesFailed}`,
  );
  console.log(engine.gamesFailed === 0 ? 'PASS' : 'FAIL');
  return engine.gamesFailed === 0 ? 0 : 1;
}

process.exitCode = main();
