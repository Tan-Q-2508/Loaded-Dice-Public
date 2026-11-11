/**
 * Re-runs the engine matrix and merges socket results parsed from a prior
 * socket-only console log, then rewrites the four QA deliverables.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runQaMatrix, writeQaReports, type SocketGameRecord } from '@shaatir-shakuni/sim';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const logPath = process.argv[2];
if (!logPath) {
  console.error('Usage: merge-qa-reports.ts <socket-terminal-log>');
  process.exit(1);
}

const log = fs.readFileSync(logPath, 'utf8');
const socket: SocketGameRecord[] = [];
const lineRe =
  /socket players=(\d+) seed=(\d+): (PASS|FAIL) phase=(\S+) hard=(\d+) chaos=(\d+) (\d+)ms/g;
let m: RegExpExecArray | null;
while ((m = lineRe.exec(log)) !== null) {
  const playerCount = Number(m[1]);
  const seed = Number(m[2]);
  const status = m[3]!;
  const finalPhase = m[4]!;
  const hardAnomalies = Number(m[5]);
  const chaosCount = Number(m[6]);
  const durationMs = Number(m[7]);
  const ok = status === 'PASS' && finalPhase === 'GAME_OVER';
  socket.push({
    layer: 'socket',
    seed,
    playerCount,
    ok,
    finalPhase,
    hardAnomalies,
    anomalies: hardAnomalies,
    durationMs,
    policies: [],
    failureMessage: ok ? undefined : `phase=${finalPhase} hard=${hardAnomalies}`,
    chaosEvents: Array.from({ length: chaosCount }, () => 'chaos'),
  });
}

// Enrich failures from FAILED_SEEDS if present (has policies/chaos detail).
const failedPath = path.join(repoRoot, 'FAILED_SEEDS.json');
if (fs.existsSync(failedPath)) {
  const failed = JSON.parse(fs.readFileSync(failedPath, 'utf8')) as {
    failures: Array<{
      layer: string;
      seed: number;
      policies?: string[];
      chaosEvents?: string[];
      failureMessage?: string;
      anomalies?: number;
    }>;
  };
  for (const f of failed.failures) {
    if (f.layer !== 'socket') continue;
    const rec = socket.find((s) => s.seed === f.seed);
    if (!rec) continue;
    const idx = socket.indexOf(rec);
    socket[idx] = {
      ...rec,
      policies: f.policies ?? rec.policies,
      chaosEvents: f.chaosEvents ?? rec.chaosEvents,
      failureMessage: f.failureMessage ?? rec.failureMessage,
      anomalies: f.anomalies ?? rec.anomalies,
    };
  }
}

console.log(`Parsed ${socket.length} socket records from log`);
const engine = runQaMatrix({
  gamesPerCount: 10,
  baseSeed: 20260807,
  maxSteps: 8000,
});
console.log(`Engine: completed=${engine.gamesCompleted} failed=${engine.gamesFailed}`);

const paths = writeQaReports(repoRoot, {
  engine,
  socket,
  generatedAt: new Date().toISOString(),
});
console.log('Wrote', paths);
const sockFail = socket.filter((s) => !s.ok || s.hardAnomalies > 0).length;
console.log(
  `Combined: engineFail=${engine.gamesFailed} socketFail=${sockFail}`,
);
