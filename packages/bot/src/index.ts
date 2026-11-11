export { bootServer, type BootedServer } from './harness/server.js';
export { BotClient, type BotSession } from './harness/bot-client.js';
export { runGame, type RunGameOptions, type RunGameResult } from './harness/run-game.js';
export { runSocketQaMatrix, type SocketQaMatrixOptions } from './qa/socket-matrix.js';
export {
  Narrator,
  defaultLogFilePath,
  type Anomaly,
  type AnomalyKind,
  type NarratorOptions,
} from './harness/narrator.js';
export { formatGameEvent } from './harness/game-events.js';
export {
  decideWireAction,
  assignDistinctPolicies,
  thinkDelayMs,
  POLICY_THINK_DELAY_MS,
  ALL_WIRE_POLICY_NAMES,
  type WirePolicyName,
  type WireDecision,
  type WirePolicyContext,
} from './policies.js';
export { runBrowserQaMatrix, type BrowserQaMatrixOptions } from './qa/browser-matrix.js';
