/**
 * Layout QA: boots one real game per player-count extreme (min=5, max=10),
 * then re-screenshots the SAME live host page at a matrix of viewport sizes
 * so we can eyeball the Dharma/Adharma board (and general court chrome) for
 * clipping/overlap across phones, tablets, laptops, and wide desktops.
 *
 *   npx tsx packages/bot/scripts/qa-viewport-matrix.ts [--headed]
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { ALL_WIRE_POLICY_NAMES, thinkDelayMs, type WirePolicyName } from '../src/policies.js';
import { bootServer } from '../src/harness/server.js';
import { mulberry32 } from '../src/harness/rng.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PLAYER_COUNTS = [5, 10] as const;

const VIEWPORTS: { name: string; width: number; height: number }[] = [
  { name: 'mobile-portrait', width: 375, height: 812 },
  { name: 'mobile-landscape', width: 812, height: 375 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'laptop-1366x768', width: 1366, height: 768 },
  { name: 'desktop-1280x720', width: 1280, height: 720 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'desktop-1920x1080', width: 1920, height: 1080 },
  { name: 'short-wide-1280x600', width: 1280, height: 600 },
  { name: 'ultrawide-2560x1080', width: 2560, height: 1080 },
  { name: 'square-900x900', width: 900, height: 900 },
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

async function getPhase(page: Page): Promise<string | null> {
  if (await page.getByTestId('game-over-panel').isVisible().catch(() => false)) {
    return 'GAME_OVER';
  }
  const board = page.locator('[data-testid="game-board"]');
  if ((await board.count()) === 0) return null;
  return board.getAttribute('data-phase');
}

async function actForPolicy(
  page: Page,
  policy: WirePolicyName,
  rng: () => number,
): Promise<boolean> {
  const phase = await getPhase(page);
  if (!phase || phase === 'GAME_OVER') return false;

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
      await buttons.nth(Math.floor(rng() * n)).click();
      return true;
    }
  }
  if (await page.getByTestId('voting-panel').isVisible().catch(() => false)) {
    if (rng() < 0.5 && (await clickFirstVisible(page, ['vote-ha']))) return true;
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
  if (await page.getByTestId('ack-akashvani').isVisible().catch(() => false)) {
    await page.getByTestId('ack-akashvani').click();
    return true;
  }
  if (await page.getByTestId('executive-panel').isVisible().catch(() => false)) {
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

async function runForPlayerCount(
  browser: Browser,
  webUrl: string,
  playerCount: number,
  outDir: string,
): Promise<void> {
  const rng = mulberry32(1000 + playerCount);
  const pool: WirePolicyName[] = ALL_WIRE_POLICY_NAMES.filter((p) => p !== 'disconnect-sim');
  const policies: WirePolicyName[] = [];
  for (let i = 0; i < playerCount; i += 1) policies.push(pool[i % pool.length]!);

  const names = Array.from({ length: playerCount }, (_, i) =>
    i === 0 ? 'Alice' : `Bot${i}`,
  );

  const contexts = await Promise.all(
    names.map(() => browser.newContext({ viewport: { width: 1280, height: 800 } })),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));

  try {
    const host = pages[0]!;
    const roomCode = await createHost(host, webUrl, names[0]!);
    console.log(`[${playerCount}p] room ${roomCode}`);

    for (let i = 1; i < pages.length; i += 1) {
      await joinRoom(pages[i]!, webUrl, roomCode, names[i]!);
    }

    await host.locator('[data-testid="start-game"]:not([disabled])').waitFor({
      state: 'visible',
      timeout: 20_000,
    });
    await host.getByTestId('start-game').click();

    for (const p of pages) {
      await p.waitForURL(/\/game/, { timeout: 30_000 });
      await p.getByTestId('game-board').waitFor({ timeout: 30_000 });
    }

    // Play a little so decree tiles actually populate the boards (more
    // representative than an all-empty 0/5, 0/6 board).
    const rngs = pages.map((_, i) => mulberry32((1000 + playerCount) * 7 + i * 131));
    const playUntil = Date.now() + 25_000;
    let reachedLegislation = false;
    while (Date.now() < playUntil) {
      const phase = await getPhase(host);
      if (phase === 'LEGISLATION_MAHARAJ' || phase === 'DECREE_CEREMONY') {
        reachedLegislation = true;
      }
      if (reachedLegislation && Date.now() > playUntil - 20_000) break;
      await Promise.all(
        pages.map(async (p, i) => {
          try {
            await actForPolicy(p, policies[i]!, rngs[i]!);
          } catch {
            // click races — ignore
          }
        }),
      );
      await sleep(150);
    }

    console.log(`[${playerCount}p] settled at phase=${await getPhase(host)}, sweeping viewports`);

    for (const vp of VIEWPORTS) {
      await host.setViewportSize({ width: vp.width, height: vp.height });
      await host.waitForTimeout(150);
      const file = path.join(outDir, `${playerCount}p-${vp.name}.png`);
      await host.screenshot({ path: file });
      console.log(`  wrote ${file}`);
    }
  } finally {
    for (const c of contexts) await c.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const headless = !process.argv.includes('--headed');
  const outDir = path.join(ROOT, 'qa-reports', 'viewport-matrix');
  fs.mkdirSync(outDir, { recursive: true });

  const server = await bootServer({ productionTimeouts: false });
  const vite = await startVite(server.url);
  const browser = await chromium.launch({ headless });

  try {
    for (const count of PLAYER_COUNTS) {
      await runForPlayerCount(browser, vite.url, count, outDir);
    }
  } finally {
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
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
