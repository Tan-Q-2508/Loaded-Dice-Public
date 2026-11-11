import fs from 'node:fs';
import path from 'node:path';
import type { MutableCoverage } from './coverage.js';
import type { QaGameResult, QaFailureCategory } from './qa-driver.js';
import type { MatrixGamePlan, QaMatrixSummary } from './qa-matrix.js';

export interface SocketGameRecord {
  readonly layer: 'socket';
  readonly seed: number;
  readonly playerCount: number;
  readonly ok: boolean;
  readonly finalPhase: string;
  readonly winner?: string;
  readonly winReason?: string;
  readonly hardAnomalies: number;
  readonly anomalies: number;
  readonly durationMs: number;
  readonly policies: readonly string[];
  readonly failureMessage?: string;
  readonly chaosEvents?: readonly string[];
}

export interface CombinedQaSummary {
  readonly engine: QaMatrixSummary;
  readonly socket: readonly SocketGameRecord[];
  readonly generatedAt: string;
}

function countBy<T>(items: readonly T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function severityFor(category: QaFailureCategory | null): string {
  switch (category) {
    case 'throw':
    case 'crash':
    case 'room_corrupted':
      return 'critical';
    case 'invariant':
    case 'hidden_info_leak':
    case 'winner_incorrect':
    case 'fsm_error':
    case 'rule_violation':
      return 'high';
    case 'room_frozen':
    case 'stuck':
    case 'stall':
    case 'max_steps':
      return 'medium';
    default:
      return 'low';
  }
}

function setToSorted(s: ReadonlySet<string | number>): string[] {
  return [...s].map(String).sort();
}

export function writeQaReports(
  outDir: string,
  combined: CombinedQaSummary,
): {
  readonly testReport: string;
  readonly bugReport: string;
  readonly failedSeeds: string;
  readonly testCoverage: string;
} {
  fs.mkdirSync(outDir, { recursive: true });

  const testReport = path.join(outDir, 'TEST_REPORT.md');
  const bugReport = path.join(outDir, 'BUG_REPORT.md');
  const failedSeeds = path.join(outDir, 'FAILED_SEEDS.json');
  const testCoverage = path.join(outDir, 'TEST_COVERAGE.md');

  fs.writeFileSync(testReport, renderTestReport(combined), 'utf8');
  fs.writeFileSync(bugReport, renderBugReport(combined), 'utf8');
  fs.writeFileSync(
    failedSeeds,
    JSON.stringify(buildFailedSeeds(combined), null, 2) + '\n',
    'utf8',
  );
  fs.writeFileSync(testCoverage, renderCoverage(combined), 'utf8');

  return { testReport, bugReport, failedSeeds, testCoverage };
}

function buildFailedSeeds(combined: CombinedQaSummary): unknown {
  const engineFails = combined.engine.results
    .filter((r) => !r.ok)
    .map((r, i) => {
      const plan = combined.engine.plans.find((p) => p.seed === r.seed);
      return {
        layer: 'engine',
        seed: r.seed,
        playerCount: r.playerCount,
        rebalanceEnabled: r.rebalanceEnabled,
        finalPhase: r.finalPhase,
        failureCategory: r.failureCategory,
        failureMessage: r.failureMessage,
        personalities: plan?.personalities ?? [],
        reproPath: r.reproPath ?? null,
        steps: r.steps,
      };
    });

  const socketFails = combined.socket
    .filter((r) => !r.ok || r.hardAnomalies > 0)
    .map((r) => ({
      layer: 'socket',
      seed: r.seed,
      playerCount: r.playerCount,
      finalPhase: r.finalPhase,
      failureMessage: r.failureMessage ?? `hardAnomalies=${r.hardAnomalies}`,
      hardAnomalies: r.hardAnomalies,
      anomalies: r.anomalies,
      policies: r.policies,
      chaosEvents: r.chaosEvents ?? [],
    }));

  return {
    generatedAt: combined.generatedAt,
    engineFailureCount: engineFails.length,
    socketFailureCount: socketFails.length,
    failures: [...engineFails, ...socketFails],
  };
}

function renderTestReport(combined: CombinedQaSummary): string {
  const eng = combined.engine;
  const sockOk = combined.socket.filter((r) => r.ok && r.hardAnomalies === 0).length;
  const sockFail = combined.socket.length - sockOk;

  const engineByCount = countBy(eng.results, (r) => String(r.playerCount));
  const engineFailByCount = countBy(
    eng.results.filter((r) => !r.ok),
    (r) => String(r.playerCount),
  );

  const categories = countBy(
    eng.results.filter((r) => !r.ok),
    (r) => r.failureCategory ?? 'unknown',
  );

  const avgSteps =
    eng.results.length === 0
      ? 0
      : Math.round(
          eng.results.reduce((a, r) => a + r.steps, 0) / eng.results.length,
        );
  const avgDuration =
    eng.results.length === 0
      ? 0
      : Math.round(
          eng.results.reduce((a, r) => a + r.durationMs, 0) / eng.results.length,
        );

  const lines: string[] = [
    '# TEST_REPORT — Adharmi Shakuni Automated QA & Stress Test',
    '',
    `Generated: ${combined.generatedAt}`,
    '',
    '## Overall statistics',
    '',
    '| Metric | Engine layer | Socket layer |',
    '|--------|-------------:|-------------:|',
    `| Games run | ${eng.results.length} | ${combined.socket.length} |`,
    `| Games completed (GAME_OVER, clean) | ${eng.gamesCompleted} | ${sockOk} |`,
    `| Games failed | ${eng.gamesFailed} | ${sockFail} |`,
    `| Total duration | ${eng.durationMs} ms | (see per-game) |`,
    `| Avg steps / game | ${avgSteps} | — |`,
    `| Avg duration / game | ${avgDuration} ms | — |`,
    '',
    '### Failure taxonomy (engine)',
    '',
  ];

  if (Object.keys(categories).length === 0) {
    lines.push('_No engine failures._', '');
  } else {
    lines.push('| Category | Count |', '|----------|------:|');
    for (const [k, v] of Object.entries(categories).sort()) {
      lines.push(`| ${k} | ${v} |`);
    }
    lines.push('');
  }

  lines.push(
    '## Matrix — 5–10 players × 10 games',
    '',
    '| Players | Games | Passed | Failed |',
    '|--------:|------:|-------:|-------:|',
  );
  for (let n = 5; n <= 10; n += 1) {
    const total = engineByCount[String(n)] ?? 0;
    const failed = engineFailByCount[String(n)] ?? 0;
    lines.push(`| ${n} | ${total} | ${total - failed} | ${failed} |`);
  }
  lines.push('');

  lines.push('## Per-game engine results', '');
  lines.push(
    '| # | Players | Seed | Rebalance | Policies | Phase | Winner | Reason | Steps | Status |',
    '|--:|--------:|-----:|:---------:|----------|-------|--------|--------|------:|--------|',
  );
  eng.results.forEach((r, i) => {
    const plan = eng.plans[i]!;
    const status = r.ok ? 'PASS' : `FAIL:${r.failureCategory}`;
    const policies = plan.personalities.join(',');
    lines.push(
      `| ${i + 1} | ${r.playerCount} | ${r.seed} | ${r.rebalanceEnabled} | ${policies} | ${r.finalPhase} | ${r.winner ?? '-'} | ${r.winReason ?? '-'} | ${r.steps} | ${status} |`,
    );
  });
  lines.push('');

  if (combined.socket.length > 0) {
    lines.push('## Socket-layer results (chaos-enabled)', '');
    lines.push(
      '| # | Players | Seed | Phase | Winner | Hard anomalies | Duration ms | Status |',
      '|--:|--------:|-----:|-------|--------|---------------:|------------:|--------|',
    );
    combined.socket.forEach((r, i) => {
      const status =
        r.ok && r.hardAnomalies === 0
          ? 'PASS'
          : r.ok
            ? 'PASS(soft anomalies)'
            : 'FAIL';
      lines.push(
        `| ${i + 1} | ${r.playerCount} | ${r.seed} | ${r.finalPhase} | ${r.winner ?? '-'} | ${r.hardAnomalies} | ${r.durationMs} | ${status} |`,
      );
    });
    lines.push('');
  }

  lines.push(
    '## Continuous checks exercised',
    '',
    '- FSM legal transitions after every `applyAction`',
    '- EC invariants (`assertInvariants`) after every transition',
    '- Hidden-information leak checks on every player view',
    '- Winner / win-reason re-validation at GAME_OVER',
    '- Illegal-action probes from `disconnect-sim` / chaotic personalities',
    '- Socket layer: disconnect/reconnect, latency, duplicate packets, simultaneous actions',
    '',
  );

  return lines.join('\n');
}

function renderBugReport(combined: CombinedQaSummary): string {
  const bugs: string[] = [
    '# BUG_REPORT — Issues discovered during QA stress test',
    '',
    `Generated: ${combined.generatedAt}`,
    '',
  ];

  const engineFails = combined.engine.results.filter((r) => !r.ok);
  const socketFails = combined.socket.filter(
    (r) => !r.ok || r.hardAnomalies > 0,
  );

  if (engineFails.length === 0 && socketFails.length === 0) {
    bugs.push(
      'No bugs discovered in this run. All engine matrix games reached GAME_OVER with passing invariants, and socket games had zero hard anomalies.',
      '',
    );
    return bugs.join('\n');
  }

  let bugId = 1;
  for (const r of engineFails) {
    const plan = combined.engine.plans.find((p) => p.seed === r.seed);
    bugs.push(
      `## BUG-${String(bugId).padStart(3, '0')} — ${r.failureCategory ?? 'unknown'}`,
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| Severity | ${severityFor(r.failureCategory)} |`,
      `| Layer | engine (pure reducer) |`,
      `| Description | ${r.failureMessage ?? '(none)'} |`,
      `| Player count | ${r.playerCount} |`,
      `| Random seed | \`${r.seed}\` |`,
      `| Rebalance | ${r.rebalanceEnabled} |`,
      `| Final phase | ${r.finalPhase} |`,
      `| Steps | ${r.steps} |`,
      `| Personalities | ${(plan?.personalities ?? []).join(', ')} |`,
      `| Repro path | ${r.reproPath ?? '(not persisted)'} |`,
      '',
      '### Steps to reproduce',
      '',
      '```bash',
      `npm run sim --workspace=@shaatir-shakuni/sim -- --games 1 --seed ${r.seed}`,
      '# Or replay the persisted repro JSON via packages/sim replayRepro()',
      '```',
      '',
      '### Suspected root cause',
      '',
      `_Triage needed._ Category \`${r.failureCategory ?? 'unknown'}\` at phase \`${r.finalPhase}\`. Inspect the repro action log and invariant message above.`,
      '',
    );
    bugId += 1;
  }

  for (const r of socketFails) {
    bugs.push(
      `## BUG-${String(bugId).padStart(3, '0')} — socket_${r.ok ? 'anomaly' : 'failure'}`,
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| Severity | ${r.ok ? 'low' : 'high'} |`,
      `| Layer | socket (Socket.IO + server) |`,
      `| Description | ${r.failureMessage ?? `hardAnomalies=${r.hardAnomalies} anomalies=${r.anomalies}`} |`,
      `| Player count | ${r.playerCount} |`,
      `| Random seed | \`${r.seed}\` |`,
      `| Final phase | ${r.finalPhase} |`,
      `| Policies | ${r.policies.join(', ')} |`,
      `| Chaos events | ${(r.chaosEvents ?? []).join('; ') || '(none logged)'} |`,
      '',
      '### Steps to reproduce',
      '',
      '```bash',
      `npm run bot --workspace=@shaatir-shakuni/bot -- --mode loop --players ${r.playerCount} --games 1 --seed ${r.seed}`,
      '```',
      '',
      '### Suspected root cause',
      '',
      '_Triage needed._ Inspect bot narration log under `packages/bot/logs/`.',
      '',
    );
    bugId += 1;
  }

  return bugs.join('\n');
}

function renderCoverage(combined: CombinedQaSummary): string {
  const cov = combined.engine.coverage;
  const allPhases = [
    'LOBBY',
    'ROLE_REVEAL',
    'ELECTION_NOMINATION',
    'ELECTION_VOTING',
    'KURUKSHETRA_ANARCHY',
    'LEGISLATION_MAHARAJ',
    'LEGISLATION_SENAPATI',
    'DECREE_CEREMONY',
    'EXECUTIVE_ACTION',
    'GAME_OVER',
  ];
  const allPowers = [
    'DIVYA_DRISHTI',
    'RAJYA_SABHA_SUMMONS',
    'AKASHVANI',
    'VANVAS',
  ];
  const allWins: string[] = [
    'DHARMA_DECREES',
    'ADHARMA_DECREES',
    'DURYODHANA_VANVAS',
    'DURYODHANA_SENAPATI',
  ];

  const winCounts = countBy(
    combined.engine.results.filter((r) => r.ok && r.winReason),
    (r) => r.winReason!,
  );

  const lines: string[] = [
    '# TEST_COVERAGE — Paths exercised by QA stress test',
    '',
    `Generated: ${combined.generatedAt}`,
    '',
    '## Player counts',
    '',
    `Exercised: ${setToSorted(cov.playerCounts).join(', ') || '(none)'}`,
    '',
    `Rebalance ON: ${cov.rebalanceOn ? 'yes' : 'no'} · Rebalance OFF: ${cov.rebalanceOff ? 'yes' : 'no'}`,
    '',
    '## Phases',
    '',
    '| Phase | Seen |',
    '|-------|:----:|',
  ];
  for (const p of allPhases) {
    lines.push(`| ${p} | ${cov.phases.has(p as never) ? 'yes' : 'no'} |`);
  }
  lines.push('');

  lines.push(
    '## Executive powers (Rajaagna)',
    '',
    '| Power | Seen |',
    '|-------|:----:|',
  );
  for (const p of allPowers) {
    lines.push(`| ${p} | ${cov.powers.has(p as never) ? 'yes' : 'no'} |`);
  }
  lines.push('');

  lines.push(
    '## Victory conditions',
    '',
    '| Win reason | Games |',
    '|------------|------:|',
  );
  for (const w of allWins) {
    lines.push(`| ${w} | ${winCounts[w] ?? 0} |`);
  }
  lines.push('');

  lines.push(
    '## Roles dealt',
    '',
    setToSorted(cov.rolesDealt).join(', ') || '(none)',
    '',
    '## Policies / personalities used',
    '',
    setToSorted(cov.policiesUsed).join(', ') || '(none)',
    '',
    '## Notable paths',
    '',
    `| Path | Exercised |`,
    `|------|:---------:|`,
    `| Veto proposed (Shakuni's Dice) | ${cov.vetoProposed ? 'yes' : 'no'} |`,
    `| Kurukshetra Anarchy | ${cov.kurukshetraAnarchy ? 'yes' : 'no'} |`,
    `| Illegal-action probes | ${cov.illegalProbes} |`,
    `| Expected rejections observed | ${cov.expectedRejections} |`,
    '',
    '## Socket chaos coverage',
    '',
  );

  if (combined.socket.length === 0) {
    lines.push('_Socket layer was not run in this invocation._', '');
  } else {
    const chaos = new Set<string>();
    for (const g of combined.socket) {
      for (const c of g.chaosEvents ?? []) chaos.add(c.split(':')[0] ?? c);
    }
    lines.push(
      `Games: ${combined.socket.length}`,
      '',
      `Chaos kinds observed: ${[...chaos].sort().join(', ') || '(none logged)'}`,
      '',
    );
  }

  lines.push(
    '## Gaps',
    '',
    coverageGaps(cov, winCounts).map((g) => `- ${g}`).join('\n') ||
      '- None identified.',
    '',
  );

  return lines.join('\n');
}

function coverageGaps(
  cov: MutableCoverage,
  winCounts: Record<string, number>,
): string[] {
  const gaps: string[] = [];
  for (const p of [
    'KURUKSHETRA_ANARCHY',
    'EXECUTIVE_ACTION',
    'LEGISLATION_SENAPATI',
  ] as const) {
    if (!cov.phases.has(p)) gaps.push(`Phase ${p} never reached`);
  }
  for (const power of [
    'DIVYA_DRISHTI',
    'RAJYA_SABHA_SUMMONS',
    'AKASHVANI',
    'VANVAS',
  ] as const) {
    if (!cov.powers.has(power)) gaps.push(`Power ${power} never granted`);
  }
  for (const w of [
    'DHARMA_DECREES',
    'ADHARMA_DECREES',
    'DURYODHANA_VANVAS',
    'DURYODHANA_SENAPATI',
  ]) {
    if (!winCounts[w]) gaps.push(`Victory ${w} never observed`);
  }
  if (!cov.vetoProposed) gaps.push('Veto path never proposed');
  if (!cov.kurukshetraAnarchy) gaps.push('Kurukshetra Anarchy never triggered');
  return gaps;
}

/** @internal exported for unit tests */
export function _testOnly_renderTestReport(
  eng: QaMatrixSummary,
  plans: readonly MatrixGamePlan[],
): string {
  return renderTestReport({
    engine: { ...eng, plans: plans.length ? plans : eng.plans },
    socket: [],
    generatedAt: new Date().toISOString(),
  });
}
