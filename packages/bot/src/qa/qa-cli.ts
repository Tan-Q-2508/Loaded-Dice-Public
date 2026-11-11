import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runQaMatrix,
  writeQaReports,
  type SocketGameRecord,
} from '@shaatir-shakuni/sim';
import { runSocketQaMatrix } from './socket-matrix.js';

function parseArgs(argv: readonly string[]): {
  gamesPerCount: number;
  baseSeed: number;
  maxSteps: number;
  outDir: string;
  engineOnly: boolean;
  socketOnly: boolean;
  stallTimeoutMs: number;
} {
  let gamesPerCount = 10;
  let baseSeed = Date.now() & 0xffffffff;
  let maxSteps = 8000;
  const here = path.dirname(fileURLToPath(import.meta.url));
  let outDir = path.resolve(here, '../../../../');
  let engineOnly = false;
  let socketOnly = false;
  let stallTimeoutMs = 25_000;

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
      case '--engine-only':
        engineOnly = true;
        break;
      case '--socket-only':
        socketOnly = true;
        break;
      case '--stall-timeout':
        stallTimeoutMs = Number(next());
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return {
    gamesPerCount,
    baseSeed,
    maxSteps,
    outDir,
    engineOnly,
    socketOnly,
    stallTimeoutMs,
  };
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const opts = parseArgs(argv);
  const generatedAt = new Date().toISOString();

  const engine = opts.socketOnly
    ? runQaMatrix({ gamesPerCount: 0, baseSeed: opts.baseSeed })
    : runQaMatrix({
        gamesPerCount: opts.gamesPerCount,
        baseSeed: opts.baseSeed,
        maxSteps: opts.maxSteps,
      });

  if (!opts.socketOnly) {
    console.log(
      `QA stress (engine): ${opts.gamesPerCount} × [5..10] = ${opts.gamesPerCount * 6} games, baseSeed=${opts.baseSeed}`,
    );
    for (const r of engine.results) {
      const status = r.ok ? 'PASS' : `FAIL:${r.failureCategory}`;
      console.log(
        `  engine players=${r.playerCount} seed=${r.seed}: ${status} phase=${r.finalPhase} winner=${r.winner ?? '-'} steps=${r.steps} ${r.durationMs}ms`,
      );
    }
  }

  let socket: SocketGameRecord[] = [];
  if (!opts.engineOnly) {
    console.log(
      `\nQA stress (socket+chaos): ${opts.gamesPerCount} × [5..10] = ${opts.gamesPerCount * 6} games, baseSeed=${(opts.baseSeed + 1) >>> 0}`,
    );
    socket = await runSocketQaMatrix({
      gamesPerCount: opts.gamesPerCount,
      baseSeed: (opts.baseSeed + 1) >>> 0,
      stallTimeoutMs: opts.stallTimeoutMs,
    });
    for (const r of socket) {
      const status =
        r.ok && r.hardAnomalies === 0
          ? 'PASS'
          : r.ok
            ? 'PASS(soft)'
            : 'FAIL';
      console.log(
        `  socket players=${r.playerCount} seed=${r.seed}: ${status} phase=${r.finalPhase} hard=${r.hardAnomalies} chaos=${r.chaosEvents?.length ?? 0} ${r.durationMs}ms`,
      );
    }
  }

  const paths = writeQaReports(opts.outDir, {
    engine,
    socket,
    generatedAt,
  });

  console.log(`\nReports written:`);
  console.log(`  ${paths.testReport}`);
  console.log(`  ${paths.bugReport}`);
  console.log(`  ${paths.failedSeeds}`);
  console.log(`  ${paths.testCoverage}`);

  const sockFail = socket.filter((s) => !s.ok || s.hardAnomalies > 0).length;
  console.log(
    `\nengine: completed=${engine.gamesCompleted} failed=${engine.gamesFailed}`,
  );
  console.log(
    `socket: completed=${socket.length - sockFail} failed=${sockFail}`,
  );
  const failed = engine.gamesFailed > 0 || sockFail > 0;
  console.log(failed ? 'FAIL' : 'PASS');
  return failed ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
