import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  assignDistinctPolicies,
  thinkDelayMs,
  type WirePolicyName,
} from '../policies.js';
import { bootServer, type BootedServer } from '../harness/server.js';
import { mulberry32 } from '../harness/rng.js';

export interface BrowserQaMatrixOptions {
  readonly gamesPerCount?: number;
  readonly baseSeed?: number;
  /** Scale think delays (1 = full, 0.15 with --fast). */
  readonly thinkScale?: number;
  readonly headless?: boolean;
  readonly webUrl?: string;
  readonly outDir?: string;
  /** Outer wall-clock cap per game. */
  readonly gameTimeoutMs?: number;
  /** Restrict to a single player count (5–10). Default: all. */
  readonly players?: number;
}

export interface BrowserGameRecord {
  readonly layer: 'browser';
  readonly seed: number;
  readonly playerCount: number;
  readonly ok: boolean;
  readonly finalPhase: string;
  readonly durationMs: number;
  readonly policies: readonly WirePolicyName[];
  readonly failureMessage?: string;
  readonly screenshotPath?: string;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForPhase(page: Page, kind: string, timeoutMs: number): Promise<void> {
  await page.waitForSelector(`[data-testid="game-board"][data-phase="${kind}"]`, {
    timeout: timeoutMs,
  });
}

async function getPhase(page: Page): Promise<string | null> {
  const board = page.locator('[data-testid="game-board"]');
  if ((await board.count()) === 0) return null;
  return board.getAttribute('data-phase');
}

async function createHost(
  page: Page,
  webUrl: string,
  name: string,
): Promise<string> {
  await page.goto(webUrl, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('display-name-input').fill(name);
  await page.getByTestId('create-room').click();
  await page.waitForURL(/\/lobby/, { timeout: 20_000 });
  const codeEl = page.getByTestId('lobby-room-code');
  await codeEl.waitFor({ timeout: 15_000 });
  const code = (await codeEl.innerText()).replace(/\s+/g, '').trim();
  if (!code || code.includes('—')) throw new Error('Host failed to get room code');
  return code;
}

async function joinRoom(page: Page, webUrl: string, code: string, name: string): Promise<void> {
  await page.goto(webUrl, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('mode-join').click();
  await page.getByTestId('room-code-input').fill(code);
  await page.getByTestId('display-name-input').fill(name);
  await page.getByTestId('join-room').click();
  await page.waitForURL(/\/lobby/, { timeout: 20_000 });
}

async function clickFirstVisible(
  page: Page,
  testIds: readonly string[],
): Promise<boolean> {
  for (const id of testIds) {
    const loc = page.getByTestId(id);
    if ((await loc.count()) > 0 && (await loc.first().isVisible().catch(() => false))) {
      await loc.first().click({ timeout: 3_000 });
      return true;
    }
  }
  return false;
}

async function actForPolicy(
  page: Page,
  policy: WirePolicyName,
  rng: () => number,
  thinkScale: number,
): Promise<boolean> {
  const phase = await getPhase(page);
  if (!phase || phase === 'GAME_OVER') return false;
  if (phase === 'ELECTION_VOTING') {
    // During reveal, ballots are gone — ready-up may still be available.
    const ha = page.getByTestId('vote-ha');
    const done = page.getByTestId('done-discussing');
    if ((await ha.count()) === 0 && (await done.count()) === 0) return false;
  }

  const delay = thinkDelayMs(policy, rng, thinkScale);
  if (delay > 0) await sleep(delay);

  if (await page.getByTestId('ack-role').isVisible().catch(() => false)) {
    await page.getByTestId('ack-role').click();
    return true;
  }

  if (await page.getByTestId('done-discussing').isVisible().catch(() => false)) {
    await page.getByTestId('done-discussing').click();
    return true;
  }

  if (await page.getByTestId('nomination-panel').isVisible().catch(() => false)) {
    const buttons = page.locator('[data-testid^="nominate-"]');
    const n = await buttons.count();
    if (n > 0) {
      const idx = Math.min(n - 1, Math.floor(rng() * n));
      await buttons.nth(idx).click();
      return true;
    }
  }

  if (await page.getByTestId('voting-panel').isVisible().catch(() => false)) {
    const preferNahi =
      policy === 'always-reject' || policy === 'paranoid' || rng() < 0.5;
    const preferHa = policy === 'loyalist' || !preferNahi;
    if (preferHa && (await clickFirstVisible(page, ['vote-ha']))) return true;
    if (await clickFirstVisible(page, ['vote-nahi', 'vote-ha'])) return true;
  }

  if (await page.getByTestId('legislation-maharaj-panel').isVisible().catch(() => false)) {
    const tiles = page.locator('[data-testid^="tile-"]');
    const n = await tiles.count();
    if (n > 0) {
      // Prefer discarding ADHARMA for loyalist (so Dharma stays in hand).
      let idx = Math.floor(rng() * n);
      for (let i = 0; i < n; i += 1) {
        const text = (await tiles.nth(i).innerText()).toUpperCase();
        if (policy === 'loyalist' && text.includes('ADHARMA')) {
          idx = i;
          break;
        }
        if (
          (policy === 'paranoid' || policy === 'duryodhana-seeking') &&
          text.includes('DHARMA')
        ) {
          idx = i;
          break;
        }
      }
      await tiles.nth(idx).click();
      return true;
    }
  }

  if (await page.getByTestId('legislation-senapati-panel').isVisible().catch(() => false)) {
    if (
      policy === 'always-veto' &&
      (await page.getByTestId('propose-veto').isVisible().catch(() => false))
    ) {
      await page.getByTestId('propose-veto').click();
      return true;
    }
    if (await clickFirstVisible(page, ['veto-ha', 'veto-nahi'])) return true;
    const tiles = page.locator('[data-testid^="tile-"]');
    const n = await tiles.count();
    if (n > 0) {
      let idx = Math.floor(rng() * n);
      for (let i = 0; i < n; i += 1) {
        const text = (await tiles.nth(i).innerText()).toUpperCase();
        if (policy === 'loyalist' && text.includes('ADHARMA')) {
          idx = i;
          break;
        }
        if (
          (policy === 'always-reject' ||
            policy === 'paranoid' ||
            policy === 'duryodhana-seeking') &&
          text.includes('DHARMA')
        ) {
          idx = i;
          break;
        }
      }
      await tiles.nth(idx).click();
      return true;
    }
  }

  if (await page.getByTestId('executive-panel').isVisible().catch(() => false)) {
    if (await clickFirstVisible(page, ['ack-akashvani'])) return true;
    const targets = page.locator('[data-testid^="exec-target-"]');
    const n = await targets.count();
    if (n > 0) {
      await targets.nth(Math.floor(rng() * n)).click({ timeout: 5_000 });
      return true;
    }
  }

  return false;
}

type Seat = {
  context: BrowserContext;
  page: Page;
  policy: WirePolicyName;
  name: string;
  rng: () => number;
  lastActAt: number;
};

async function runOneBrowserGame(
  browser: Browser,
  webUrl: string,
  opts: {
    playerCount: number;
    seed: number;
    thinkScale: number;
    gameTimeoutMs: number;
    outDir: string;
    index: number;
  },
): Promise<BrowserGameRecord> {
  const started = Date.now();
  const rng = mulberry32(opts.seed);
  const policies = assignDistinctPolicies(opts.playerCount, rng);
  const seats: Seat[] = [];
  let finalPhase = 'UNKNOWN';
  let failureMessage: string | undefined;
  let screenshotPath: string | undefined;

  try {
    for (let i = 0; i < opts.playerCount; i += 1) {
      const context = await browser.newContext();
      const page = await context.newPage();
      seats.push({
        context,
        page,
        policy: policies[i]!,
        name: `P${i + 1}-${policies[i]}`,
        rng: mulberry32((opts.seed + (i + 1) * 7919) >>> 0),
        lastActAt: 0,
      });
    }

    const host = seats[0]!;
    const roomCode = await createHost(host.page, webUrl, host.name);
    for (let i = 1; i < seats.length; i += 1) {
      await joinRoom(seats[i]!.page, webUrl, roomCode, seats[i]!.name);
    }

    // Wait until host can start (5–10 seats).
    await host.page
      .locator('[data-testid="start-game"]:not([disabled])')
      .waitFor({ state: 'visible', timeout: 20_000 });
    await host.page.getByTestId('start-game').click();

    for (const s of seats) {
      await s.page.waitForURL(/\/game/, { timeout: 30_000 });
      await s.page.getByTestId('game-board').waitFor({ timeout: 30_000 });
    }

    // Light chaos: one non-host reloads mid-game after role reveal.
    const chaosSeat = seats.length > 2 && opts.index % 3 === 0 ? seats[2]! : null;
    let chaosDone = false;

    while (Date.now() - started < opts.gameTimeoutMs) {
      const phase = (await getPhase(host.page)) ?? 'UNKNOWN';
      finalPhase = phase;
      if (phase === 'GAME_OVER') {
        await waitForPhase(host.page, 'GAME_OVER', 5_000).catch(() => undefined);
        const boardOk = (await host.page.getByTestId('game-board').count()) > 0;
        if (!boardOk) {
          throw new Error('GAME_OVER without game-board');
        }
        for (const s of seats) {
          await s.context.close().catch(() => undefined);
        }
        return {
          layer: 'browser',
          seed: opts.seed,
          playerCount: opts.playerCount,
          ok: true,
          finalPhase,
          durationMs: Date.now() - started,
          policies,
        };
      }

      if (
        chaosSeat &&
        !chaosDone &&
        (phase === 'ELECTION_VOTING' || phase === 'ELECTION_NOMINATION')
      ) {
        chaosDone = true;
        await chaosSeat.page.reload({ waitUntil: 'domcontentloaded' });
        await chaosSeat.page.getByTestId('game-board').waitFor({ timeout: 30_000 });
      }

      await Promise.all(
        seats.map(async (s) => {
          const now = Date.now();
          if (now - s.lastActAt < 400) return;
          try {
            const acted = await actForPolicy(s.page, s.policy, s.rng, opts.thinkScale);
            if (acted) s.lastActAt = Date.now();
          } catch {
            // Per-seat click races are expected under chaos; retry next tick.
          }
        }),
      );
      await sleep(250);
    }

    failureMessage = `Timed out after ${opts.gameTimeoutMs}ms in phase=${finalPhase}`;
  } catch (err) {
    failureMessage = err instanceof Error ? err.message : String(err);
  }

  try {
    const shotDir = path.join(opts.outDir, 'screenshots');
    fs.mkdirSync(shotDir, { recursive: true });
    screenshotPath = path.join(
      shotDir,
      `fail-p${opts.playerCount}-s${opts.seed}.png`,
    );
    if (seats[0]) await seats[0].page.screenshot({ path: screenshotPath, fullPage: true });
  } catch {
    // ignore screenshot errors
  }

  for (const s of seats) {
    await s.context.close().catch(() => undefined);
  }

  return {
    layer: 'browser',
    seed: opts.seed,
    playerCount: opts.playerCount,
    ok: false,
    finalPhase,
    durationMs: Date.now() - started,
    policies,
    failureMessage,
    screenshotPath,
  };
}

async function startVite(socketUrl: string): Promise<{ url: string; child: ChildProcess }> {
  const port = 5173 + Math.floor(Math.random() * 200);
  const viteBin = path.join(
    ROOT,
    'node_modules',
    'vite',
    'bin',
    'vite.js',
  );
  const child = spawn(
    process.execPath,
    [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: path.join(ROOT, 'packages', 'web'),
      env: {
        ...process.env,
        VITE_SOCKET_URL: socketUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const url = `http://127.0.0.1:${port}`;
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) {
        return { url, child };
      }
    } catch {
      // not up yet
    }
    await sleep(400);
  }
  child.kill();
  throw new Error('Vite failed to start within 60s');
}

/**
 * Playwright matrix: playerCount 5–10 × N games through the real web UI,
 * against an in-memory server with **production** ceremony timeouts.
 */
export async function runBrowserQaMatrix(
  opts: BrowserQaMatrixOptions = {},
): Promise<BrowserGameRecord[]> {
  const gamesPerCount = opts.gamesPerCount ?? 10;
  const baseSeed = opts.baseSeed ?? (Date.now() & 0xffffffff);
  const thinkScale = opts.thinkScale ?? 1;
  const headless = opts.headless ?? true;
  const outDir =
    opts.outDir ??
    path.join(ROOT, 'qa-reports', `browser-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(outDir, { recursive: true });

  // Production ceremonies make long games; give generous wall clock.
  const gameTimeoutMs = opts.gameTimeoutMs ?? 12 * 60_000;

  let server: BootedServer | null = null;
  let vite: { url: string; child: ChildProcess } | null = null;
  let browser: Browser | null = null;
  const records: BrowserGameRecord[] = [];

  try {
    server = await bootServer({ productionTimeouts: true });
    vite = opts.webUrl
      ? null
      : await startVite(server.url);
    const webUrl = opts.webUrl ?? vite!.url;

    browser = await chromium.launch({ headless });
    let index = 0;
    const minPlayers = opts.players ?? 5;
    const maxPlayers = opts.players ?? 10;
    if (minPlayers < 5 || maxPlayers > 10 || minPlayers > maxPlayers) {
      throw new Error(`players must be an integer 5–10 (got ${opts.players})`);
    }
    for (let playerCount = minPlayers; playerCount <= maxPlayers; playerCount += 1) {
      for (let g = 0; g < gamesPerCount; g += 1) {
        const seed = (baseSeed + index * 9973 + playerCount * 131) >>> 0;
        // eslint-disable-next-line no-console
        console.log(
          `  … browser game ${index + 1} players=${playerCount} seed=${seed} policies pending`,
        );
        const record = await runOneBrowserGame(browser, webUrl, {
          playerCount,
          seed,
          thinkScale,
          gameTimeoutMs,
          outDir,
          index,
        });
        records.push(record);
        const status = record.ok ? 'PASS' : 'FAIL';
        // eslint-disable-next-line no-console
        console.log(
          `  browser players=${playerCount} seed=${seed}: ${status} phase=${record.finalPhase} ${record.durationMs}ms${
            record.failureMessage ? ` — ${record.failureMessage}` : ''
          }`,
        );
        index += 1;
      }
    }
  } finally {
    await browser?.close().catch(() => undefined);
    if (vite?.child.pid) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(vite.child.pid), '/T', '/F'], {
            stdio: 'ignore',
          });
        } else {
          vite.child.kill('SIGKILL');
        }
      } catch {
        vite.child.kill();
      }
    }
    await server?.stop().catch(() => undefined);
    const reportPath = path.join(outDir, 'browser-matrix.json');
    fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2));
    // eslint-disable-next-line no-console
    console.log(`Browser report: ${reportPath}`);
  }

  return records;
}
