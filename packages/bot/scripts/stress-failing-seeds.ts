import { bootServer } from '../src/harness/server.js';
import { runGame } from '../src/harness/run-game.js';
import { Narrator } from '../src/harness/narrator.js';
import type { WirePolicyName } from '../policies.js';

const CASES = [
  {
    seed: 20471158,
    playerCount: 7,
    rebalanceEnabled: true,
    policies: [
      'disconnect-sim',
      'disconnect-sim',
      'random',
      'always-veto',
      'duryodhana-seeking',
      'disconnect-sim',
      'always-veto',
    ] as const satisfies readonly WirePolicyName[],
  },
  {
    seed: 20501077,
    playerCount: 7,
    rebalanceEnabled: false,
    policies: [
      'random',
      'random',
      'disconnect-sim',
      'always-veto',
      'always-reject',
      'always-reject',
      'disconnect-sim',
    ] as const satisfies readonly WirePolicyName[],
  },
  {
    seed: 20521023,
    playerCount: 7,
    rebalanceEnabled: false,
    policies: [
      'disconnect-sim',
      'disconnect-sim',
      'random',
      'always-veto',
      'duryodhana-seeking',
      'always-reject',
      'random',
    ] as const satisfies readonly WirePolicyName[],
  },
  {
    seed: 20640830,
    playerCount: 8,
    rebalanceEnabled: true,
    policies: [
      'duryodhana-seeking',
      'duryodhana-seeking',
      'random',
      'disconnect-sim',
      'always-reject',
      'random',
      'always-veto',
      'random',
    ] as const satisfies readonly WirePolicyName[],
  },
  {
    seed: 20740691,
    playerCount: 9,
    rebalanceEnabled: false,
    policies: [
      'duryodhana-seeking',
      'duryodhana-seeking',
      'random',
      'disconnect-sim',
      'always-reject',
      'random',
      'disconnect-sim',
      'random',
      'random',
    ] as const satisfies readonly WirePolicyName[],
  },
];

const rounds = Number(process.argv[2] ?? 3);

let fail = 0;
for (let r = 1; r <= rounds; r += 1) {
  for (const c of CASES) {
    const server = await bootServer();
    const narrator = new Narrator({ quiet: true });
    try {
      const result = await runGame({
        url: server.url,
        memory: server.memory,
        playerCount: c.playerCount,
        narrator,
        seed: c.seed,
        speedMs: 0,
        stallTimeoutMs: 25_000,
        rebalanceEnabled: c.rebalanceEnabled,
        policyAssignment: c.policies,
        chaosEnabled: true,
      });
      const status =
        result.ok && result.hardAnomalies === 0
          ? 'PASS'
          : `FAIL phase=${result.finalPhase} hard=${result.hardAnomalies}`;
      console.log(`r${r} seed=${c.seed}: ${status} chaos=${result.chaosEvents.length}`);
      if (!result.ok || result.hardAnomalies > 0) {
        fail += 1;
        const freezes = narrator.anomalies.filter(
          (a) => a.kind === 'room_frozen' || a.kind === 'room_corrupted' || a.kind === 'stall',
        );
        console.log('  detail', freezes);
        console.log('  chaos', result.chaosEvents);
      }
    } finally {
      narrator.close();
      await server.stop();
    }
  }
}
console.log(`DONE fails=${fail}/${rounds * CASES.length}`);
process.exitCode = fail === 0 ? 0 : 1;
