/**
 * Verify responsive UI: one 10-player game, each seat a different device size.
 *
 *   npx tsx packages/bot/scripts/demo-10p-viewport-tour.ts [--fast] [--headed]
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  assignDistinctPolicies,
  thinkDelayMs,
  type WirePolicyName,
} from '../src/policies.js';
import { bootServer } from '../src/harness/server.js';
import { mulberry32 } from '../src/harness/rng.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PLAYER_COUNT = 10;

const VIEWPORTS = [
  { id: 'phone-360', width: 360, height: 640, hasTouch: true },
  { id: 'phone-375', width: 375, height: 667, hasTouch: true },
  { id: 'phone-390', width: 390, height: 844, hasTouch: true },
  { id: 'phone-414', width: 414, height: 896, hasTouch: true },
  { id: 'tablet-768', width: 768, height: 1024, hasTouch: true },
  { id: 'tablet-820', width: 820, height: 1180, hasTouch: true },
  { id: 'tablet-1024', width: 1024, height: 768, hasTouch: true },
  { id: 'desktop-1280', width: 1280, height: 720, hasTouch: false },
  { id: 'desktop-1440', width: 1440, height: 900, hasTouch: false },
  { id: 'desktop-1920', width: 1920, height: 1080, hasTouch: false },
] as const;

type OverflowReport = {
  readonly viewport: string;
  readonly width: number;
  readonly height: number;
  readonly screen: string;
  readonly phase: string;
  readonly overflowX: boolean;
  readonly clientWidth: number;
  readonly scrollWidth: number;
  readonly missing: readonly string[];
  readonly fullscreenToggle: boolean;
  readonly fullscreenOk: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getPhase(page: Page): Promise<string | null> {
  if (await page.getByTestId('game-over-panel').isVisible().catch(() => false)) {
    return 'GAME_OVER';
  }
  const board = page.locator('[data-testid="game-board"]');
  if ((await board.count()) > 0) return board.getAttribute('data-phase');
  if (await page.getByTestId('role-card').isVisible().catch(() => false)) {
    return 'ROLE_REVEAL';
  }
  if (page.url().includes('/lobby')) return 'LOBBY';
  try {
    const pathName = new URL(page.url()).pathname;
    if (pathName === '/' || pathName === '') return 'HOME';
  } catch {
    return null;
  }
  return null;
}

async function waitUntilConnected(page: Page): Promise<void> {
  await page.getByText('Connected to the court').waitFor({ timeout: 30_000 });
}

async function createHost(page: Page, webUrl: string, name: string): Promise<string> {
  await page.goto(webUrl, { waitUntil: 'domcontentloaded' });
  await waitUntilConnected(page);
  await page.getByTestId('display-name-input').fill(name);
  const create = page.getByTestId('create-room');
  await create.waitFor({ state: 'visible', timeout: 10_000 });
  await create.click({ timeout: 15_000 });
  await page.waitForURL(/\/lobby/, { timeout: 30_000 });
  const codeEl = page.getByTestId('lobby-room-code');
  await codeEl.waitFor({ timeout: 15_000 });
  const code = (await codeEl.innerText()).replace(/\s+/g, '').trim();
  if (!code || code.includes('—')) throw new Error('Host failed to get room code');
  return code;
}

async function joinRoom(page: Page, webUrl: string, code: string, name: string): Promise<void> {
  await page.goto(webUrl, { waitUntil: 'domcontentloaded' });
  await waitUntilConnected(page);
  await page.getByTestId('mode-join').click();
  await page.getByTestId('room-code-input').fill(code);
  await page.getByTestId('display-name-input').fill(name);
  await page.getByTestId('join-room').click({ timeout: 15_000 });
  await page.waitForURL(/\/lobby/, { timeout: 30_000 });
}

async function clickFirstVisible(page: Page, testIds: readonly string[]): Promise<boolean> {
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
  if (!phase || phase === 'GAME_OVER' || phase === 'HOME' || phase === 'LOBBY') return false;

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
      await buttons.nth(Math.min(n - 1, Math.floor(rng() * n))).click();
      return true;
    }
  }
  if (await page.getByTestId('voting-panel').isVisible().catch(() => false)) {
    const preferNahi =
      policy === 'always-reject' || policy === 'paranoid' || rng() < 0.5;
    if (!preferNahi && (await clickFirstVisible(page, ['vote-ha']))) return true;
    if (await clickFirstVisible(page, ['vote-nahi', 'vote-ha'])) return true;
  }
  if (await page.getByTestId('legislation-maharaj-panel').isVisible().catch(() => false)) {
    const tiles = page.locator('[data-testid^="tile-"]');
    const n = await tiles.count();
    if (n > 0) {
      await tiles.nth(Math.floor(rng() * n)).click();
      return true;
    }
  }
  if (await page.getByTestId('legislation-senapati-panel').isVisible().catch(() => false)) {
    if (await clickFirstVisible(page, ['veto-ha', 'veto-nahi'])) return true;
    const tiles = page.locator('[data-testid^="tile-"]');
    const n = await tiles.count();
    if (n > 0) {
      await tiles.nth(Math.floor(rng() * n)).click();
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

async function startVite(socketUrl: string): Promise<{ url: string; child: ChildProcess }> {
  const port = 5173 + Math.floor(Math.random() * 200);
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(
    process.execPath,
    [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: path.join(ROOT, 'packages', 'web'),
      env: { ...process.env, VITE_SOCKET_URL: socketUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const url = `http://127.0.0.1:${port}`;
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return { url, child };
    } catch {
      // waiting
    }
    await sleep(400);
  }
  child.kill();
  throw new Error('Vite failed to start within 60s');
}

async function measureOverflow(
  page: Page,
  viewportId: string,
  width: number,
  height: number,
  screen: string,
): Promise<OverflowReport> {
  const metrics = await page.evaluate(() => {
    const de = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(de.scrollWidth, body.scrollWidth);
    const clientWidth = de.clientWidth;
    return { clientWidth, scrollWidth };
  });
  const phase = (await getPhase(page)) ?? 'UNKNOWN';
  const wanted =
    phase === 'HOME'
      ? ['display-name-input', 'create-room']
      : phase === 'LOBBY'
        ? ['lobby-room-code']
        : phase === 'ROLE_REVEAL'
          ? ['role-card']
          : phase === 'GAME_OVER'
            ? ['game-over-panel']
            : ['game-board', 'policy-tracks', 'player-circle'];
  const missing: string[] = [];
  for (const id of wanted) {
    const n = await page.getByTestId(id).count();
    if (n === 0) missing.push(id);
  }
  const fullscreenToggle = await page.getByTestId('fullscreen-toggle').isVisible().catch(() => false);
  const expectToggle = phase !== 'HOME' && phase !== 'LOBBY';
  return {
    viewport: viewportId,
    width,
    height,
    screen,
    phase,
    overflowX: metrics.scrollWidth > metrics.clientWidth + 2,
    clientWidth: metrics.clientWidth,
    scrollWidth: metrics.scrollWidth,
    missing,
    fullscreenToggle,
    fullscreenOk: fullscreenToggle === expectToggle,
  };
}

type Seat = {
  context: BrowserContext;
  page: Page;
  policy: WirePolicyName;
  name: string;
  viewport: (typeof VIEWPORTS)[number];
  rng: () => number;
  lastActAt: number;
};

async function snapshotSeats(
  seats: readonly Seat[],
  shotDir: string,
  label: string,
  reports: OverflowReport[],
): Promise<void> {
  for (const s of seats) {
    const file = `${label}-${s.viewport.id}.png`;
    await s.page.screenshot({ path: path.join(shotDir, file), fullPage: true });
    reports.push(await measureOverflow(s.page, s.viewport.id, s.viewport.width, s.viewport.height, label));
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const thinkScale = argv.includes('--fast') ? 0.15 : 0.15;
  const headless = !argv.includes('--headed');
  const seed = 20260814;
  const outDir = path.join(ROOT, 'qa-reports', 'demo-10p-viewports');
  const shotDir = path.join(outDir, 'screenshots');
  fs.mkdirSync(shotDir, { recursive: true });

  console.log(
    `10p viewport tour → ${outDir} (thinkScale=${thinkScale}, headless=${headless})`,
  );

  const server = await bootServer({ productionTimeouts: false });
  const vite = await startVite(server.url);
  const browser: Browser = await chromium.launch({ headless });

  const rng = mulberry32(seed);
  const policies = assignDistinctPolicies(PLAYER_COUNT, rng).map((p) =>
    p === 'disconnect-sim' ? 'random' : p,
  );
  const seats: Seat[] = [];
  const reports: OverflowReport[] = [];
  const timeline: { t: number; phase: string }[] = [];
  let lastPhase: string | null = null;

  try {
    for (let i = 0; i < PLAYER_COUNT; i += 1) {
      const vp = VIEWPORTS[i]!;
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.hasTouch,
        hasTouch: vp.hasTouch,
      });
      const page = await context.newPage();
      seats.push({
        context,
        page,
        policy: policies[i]!,
        name: `P${i + 1}-${vp.id}`,
        viewport: vp,
        rng: mulberry32((seed + (i + 1) * 7919) >>> 0),
        lastActAt: 0,
      });
    }

    const host = seats[0]!;
    console.log('Seats:', seats.map((s) => `${s.name} ${s.viewport.width}x${s.viewport.height}`).join(' | '));

    await host.page.goto(vite.url, { waitUntil: 'domcontentloaded' });
    await waitUntilConnected(host.page);
    await snapshotSeats([host], shotDir, '01-home', reports);

    const roomCode = await createHost(host.page, vite.url, host.name);
    console.log('Room', roomCode, 'web', vite.url);

    for (let i = 1; i < seats.length; i += 1) {
      await joinRoom(seats[i]!.page, vite.url, roomCode, seats[i]!.name);
      console.log(`Joined ${seats[i]!.name}`);
    }

    await host.page
      .locator('[data-testid="start-game"]:not([disabled])')
      .waitFor({ state: 'visible', timeout: 20_000 });
    await snapshotSeats(seats, shotDir, '02-lobby', reports);

    await host.page.getByTestId('start-game').click();

    for (const s of seats) {
      await s.page.waitForURL(/\/game/, { timeout: 30_000 });
      await Promise.race([
        s.page.getByTestId('game-board').waitFor({ timeout: 30_000 }),
        s.page.getByTestId('role-card').waitFor({ timeout: 30_000 }),
        s.page.getByTestId('game-over-panel').waitFor({ timeout: 30_000 }),
      ]);
    }

    await snapshotSeats(seats, shotDir, '03-role-reveal', reports);

    const started = Date.now();
    const gameTimeoutMs = 15 * 60_000;
    let midGameShot = false;

    while (Date.now() - started < gameTimeoutMs) {
      const phase = (await getPhase(host.page)) ?? 'UNKNOWN';
      if (phase !== lastPhase) {
        lastPhase = phase;
        timeline.push({ t: Date.now() - started, phase });
        console.log(`[+${Math.round((Date.now() - started) / 1000)}s] phase=${phase}`);
      }

      if (
        !midGameShot &&
        (phase === 'ELECTION_NOMINATION' ||
          phase === 'ELECTION_VOTING' ||
          phase === 'DISCUSSION_PRE_VOTE')
      ) {
        midGameShot = true;
        await snapshotSeats(seats, shotDir, '04-midgame', reports);
      }

      if (phase === 'GAME_OVER') {
        await sleep(800);
        await snapshotSeats(seats, shotDir, '05-game-over', reports);
        break;
      }

      await Promise.all(
        seats.map(async (s) => {
          const now = Date.now();
          if (now - s.lastActAt < 350) return;
          try {
            const acted = await actForPolicy(s.page, s.policy, s.rng, thinkScale);
            if (acted) s.lastActAt = Date.now();
          } catch {
            // click races
          }
        }),
      );
      await sleep(200);
    }

    if (lastPhase !== 'GAME_OVER') {
      throw new Error(`Did not reach GAME_OVER (last=${lastPhase})`);
    }

    const overflows = reports.filter(
      (r) => r.overflowX || r.missing.length > 0 || !r.fullscreenOk,
    );
    const summary = {
      roomCode,
      playerCount: PLAYER_COUNT,
      policies,
      viewports: VIEWPORTS,
      durationMs: Date.now() - started,
      timeline,
      reports,
      overflowCount: overflows.length,
      ok: overflows.length === 0,
    };
    fs.writeFileSync(path.join(outDir, 'viewport-report.json'), JSON.stringify(summary, null, 2));
    if (overflows.length > 0) process.exitCode = 1;
    console.log(
      overflows.length === 0
        ? 'PASS — no overflow, landmarks present, fullscreen only in-game'
        : `ISSUES — ${overflows.length} overflow/missing/fullscreen rows (see viewport-report.json)`,
    );
    for (const row of overflows) {
      console.log(
        `  ${row.viewport} ${row.screen} phase=${row.phase} overflowX=${row.overflowX} ${row.clientWidth}→${row.scrollWidth} missing=${row.missing.join(',')} fullscreen=${row.fullscreenToggle} ok=${row.fullscreenOk}`,
      );
    }
  } finally {
    for (let i = seats.length - 1; i >= 0; i -= 1) {
      await seats[i]!.context.close().catch(() => undefined);
    }
    await browser.close().catch(() => undefined);
    if (vite.child.pid) {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(vite.child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        vite.child.kill('SIGKILL');
      }
    }
    await server.stop().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
