import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type AnomalyKind =
  | 'unexpected_rejection'
  | 'concurrency_conflict'
  | 'room_frozen'
  | 'room_corrupted'
  | 'stall'
  | 'invalid_payload'
  | 'unexpected_disconnect'
  | 'protocol_mismatch'
  | 'crash';

export type Anomaly = {
  readonly kind: AnomalyKind;
  readonly detail: string;
  readonly atMs: number;
};

export type NarratorOptions = {
  /** Absolute path to a log file to mirror all lines to. Directory is created if missing. */
  readonly logFile?: string;
  /** Suppress console output (still writes to the log file). Useful for loop mode. */
  readonly quiet?: boolean;
  /** Prefix every line with this label (useful in loop mode: "[game 12] ..."). */
  readonly label?: string;
};

/**
 * Single interleaved, timestamped narration of a bot match: readable console
 * output + a mirrored log file, plus a running list of anomalies (unexpected
 * server rejections, freezes, stalls, schema failures, disconnects) that the
 * human should look at.
 */
export class Narrator {
  readonly anomalies: Anomaly[] = [];
  private readonly startedAtMs = Date.now();
  private readonly quiet: boolean;
  private readonly label: string | null;
  private stream: fs.WriteStream | null = null;

  constructor(opts: NarratorOptions = {}) {
    this.quiet = opts.quiet ?? false;
    this.label = opts.label ?? null;
    if (opts.logFile) {
      fs.mkdirSync(path.dirname(opts.logFile), { recursive: true });
      this.stream = fs.createWriteStream(opts.logFile, { flags: 'a' });
    }
  }

  line(text: string): void {
    const prefixed = this.label ? `${this.label} ${text}` : text;
    const stamped = `[${new Date().toLocaleTimeString()}] ${prefixed}`;
    if (!this.quiet) {
      // eslint-disable-next-line no-console
      console.log(stamped);
    }
    this.stream?.write(`${stamped}\n`);
  }

  warn(text: string): void {
    this.line(`\u26A0 ${text}`);
  }

  anomaly(kind: AnomalyKind, detail: string): void {
    this.anomalies.push({ kind, detail, atMs: Date.now() - this.startedAtMs });
    this.warn(`[anomaly:${kind}] ${detail}`);
  }

  summary(): string {
    if (this.anomalies.length === 0) return 'No anomalies detected.';
    const counts = new Map<AnomalyKind, number>();
    for (const a of this.anomalies) {
      counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
    }
    const parts = [...counts.entries()].map(([kind, n]) => `${kind}=${n}`);
    return `${this.anomalies.length} anomalies (${parts.join(', ')})`;
  }

  close(): void {
    this.stream?.end();
  }
}

export function defaultLogFilePath(prefix = 'match'): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../logs', `${prefix}-${stamp}.log`);
}
