/**
 * Replays the socket QA failures with the exact matrix policy mixes.
 */
import { bootServer } from '../src/harness/server.js';
import { runGame } from '../src/harness/run-game.js';
import { Narrator } from '../src/harness/narrator.js';
import type { WirePolicyName } from '../policies.js';

const CASES: readonly {
  readonly seed: number;
  readonly playerCount: number;
  readonly policies: readonly WirePolicyName[];
  readonly rebalanceEnabled: boolean;
  readonly label: string;
}[] = [
  {
    label: 'ROOM_FROZEN',
    seed: 20471158,
    playerCount: 7,
    rebalanceEnabled: true, // g=1 for 7p block → odd index within count? check matrix
    policies: [
      'disconnect-sim',
      'disconnect-sim',
      'random',
      'always-veto',
      'duryodhana-seeking',
      'disconnect-sim',
      'always-veto',
    ],
  },
  {
    label: 'STALL_HOST_RECONNECT',
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
    ],
  },
  {
    label: 'STALL_HOST_RECONNECT_2',
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
    ],
  },
];

async function runOne(c: (typeof CASES)[number], chaosEnabled: boolean): Promise<void> {
  const server = await bootServer();
  const narrator = new Narrator({ quiet: false });
  console.log(`\n=== ${c.label} seed=${c.seed} chaos=${chaosEnabled} ===`);
  try {
    const result = await Promise.race([
      runGame({
        url: server.url,
        memory: server.memory,
        playerCount: c.playerCount,
        narrator,
        seed: c.seed,
        speedMs: 0,
        stallTimeoutMs: 20_000,
        rebalanceEnabled: c.rebalanceEnabled,
        policyAssignment: c.policies,
        chaosEnabled,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('outer 90s')), 90_000),
      ),
    ]);
    console.log('RESULT', {
      ok: result.ok,
      finalPhase: result.finalPhase,
      hard: result.hardAnomalies,
      anomalies: result.anomalies,
      chaos: result.chaosEvents,
      winner: result.winner,
    });
    console.log('anomalies detail:', narrator.anomalies.slice(0, 20));
    const freeze = narrator.anomalies.filter(
      (a) => a.kind === 'room_frozen' || a.kind === 'room_corrupted',
    );
    if (freeze.length) console.log('FREEZE DETAIL', freeze);
  } catch (err) {
    console.error('ERROR', err);
  } finally {
    narrator.close();
    await server.stop();
  }
}

const only = process.argv[2];
const chaos = process.argv[3] !== 'no-chaos';
for (const c of CASES) {
  if (only && !c.label.includes(only) && String(c.seed) !== only) continue;
  await runOne(c, chaos);
}
