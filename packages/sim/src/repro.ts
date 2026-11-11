import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { GameRepro } from './types.js';

export function writeRepro(
  repro: GameRepro,
  failuresDir: string,
): string {
  mkdirSync(failuresDir, { recursive: true });
  const slug = repro.failure.kind.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${stamp}-seed${repro.seed}-${slug}.json`;
  const filePath = path.join(failuresDir, filename);
  writeFileSync(filePath, `${JSON.stringify(repro, null, 2)}\n`, 'utf8');
  return filePath;
}

export function defaultFailuresDir(): string {
  return path.resolve(process.cwd(), 'failures');
}
