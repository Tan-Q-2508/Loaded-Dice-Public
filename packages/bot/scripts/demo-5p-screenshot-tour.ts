/**
 * Demo: one 5-player game through the real web UI (Playwright), with
 * host-seat video + a screenshot on every phase change.
 *
 *   npx tsx packages/bot/scripts/demo-5p-screenshot-tour.ts [--fast] [--headed]
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getPhase(page: Page): Promise<string | null> {
  const board = page.locator('[data-testid="game-board"]');
  if ((await board.count()) === 0) return null;
  return board.getAttribute('data-phase');
}

async function createHost(page: Page, webUrl: string, name: string): Promise<string> {
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
  if (!phase || phase === 'GAME_OVER' || phase === 'DECREE_CEREMONY') return false;
  if (phase === 'ELECTION_VOTING') {
    const ha = page.getByTestId('vote-ha');
    if ((await ha.count()) === 0) return false;
  }

  const delay = thinkDelayMs(policy, rng, thinkScale);
  if (delay > 0) await sleep(delay);

  if (await page.getByTestId('ack-role').isVisible().catch(() => false)) {
    await page.getByTestId('ack-role').click();
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

type Seat = {
  context: BrowserContext;
  page: Page;
  policy: WirePolicyName;
  name: string;
  rng: () => number;
  lastActAt: number;
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const thinkScale = argv.includes('--fast') ? 0.15 : 1;
  const headless = !argv.includes('--headed');
  const seed = 20260808;
  const outDir = path.join(ROOT, 'qa-reports', 'demo-5p-tour');
  const shotDir = path.join(outDir, 'screenshots');
  const videoDir = path.join(outDir, 'video');
  fs.mkdirSync(shotDir, { recursive: true });
  fs.mkdirSync(videoDir, { recursive: true });

  console.log(`Demo 5p tour → ${outDir} (thinkScale=${thinkScale}, headless=${headless})`);

  const server = await bootServer({ productionTimeouts: true });
  const vite = await startVite(server.url);
  const browser: Browser = await chromium.launch({ headless });

  const rng = mulberry32(seed);
  const policies = assignDistinctPolicies(5, rng);
  const seats: Seat[] = [];
  const timeline: { t: number; phase: string; file: string }[] = [];
  let shotIdx = 0;
  let lastPhase: string | null = null;

  try {
    for (let i = 0; i < 5; i += 1) {
      const isHost = i === 0;
      const context = await browser.newContext(
        isHost
          ? {
              recordVideo: {
                dir: videoDir,
                size: { width: 1280, height: 720 },
              },
              viewport: { width: 1280, height: 720 },
            }
          : { viewport: { width: 1280, height: 720 } },
      );
      const page = await context.newPage();
      seats.push({
        context,
        page,
        policy: policies[i]!,
        name: `P${i + 1}-${policies[i]}`,
        rng: mulberry32((seed + (i + 1) * 7919) >>> 0),
        lastActAt: 0,
      });
    }

    const host = seats[0]!;
    console.log('Policies:', policies.join(', '));

    const roomCode = await createHost(host.page, vite.url, host.name);
    console.log('Room', roomCode, 'web', vite.url);

    await host.page.screenshot({
      path: path.join(shotDir, `${String(++shotIdx).padStart(2, '0')}-lobby-host.png`),
      fullPage: true,
    });
    timeline.push({ t: 0, phase: 'LOBBY', file: `${String(shotIdx).padStart(2, '0')}-lobby-host.png` });

    for (let i = 1; i < seats.length; i += 1) {
      await joinRoom(seats[i]!.page, vite.url, roomCode, seats[i]!.name);
    }

    await host.page
      .locator('[data-testid="start-game"]:not([disabled])')
      .waitFor({ state: 'visible', timeout: 20_000 });
    await host.page.screenshot({
      path: path.join(shotDir, `${String(++shotIdx).padStart(2, '0')}-lobby-full.png`),
      fullPage: true,
    });
    timeline.push({
      t: Date.now(),
      phase: 'LOBBY_FULL',
      file: `${String(shotIdx).padStart(2, '0')}-lobby-full.png`,
    });

    await host.page.getByTestId('start-game').click();

    for (const s of seats) {
      await s.page.waitForURL(/\/game/, { timeout: 30_000 });
      await s.page.getByTestId('game-board').waitFor({ timeout: 30_000 });
    }

    const started = Date.now();
    const gameTimeoutMs = 12 * 60_000;

    while (Date.now() - started < gameTimeoutMs) {
      const phase = (await getPhase(host.page)) ?? 'UNKNOWN';
      if (phase !== lastPhase) {
        lastPhase = phase;
        const file = `${String(++shotIdx).padStart(2, '0')}-${phase.toLowerCase()}.png`;
        await host.page.screenshot({ path: path.join(shotDir, file), fullPage: true });
        timeline.push({ t: Date.now() - started, phase, file });
        console.log(`[+${Math.round((Date.now() - started) / 1000)}s] phase=${phase} → ${file}`);
      }

      if (phase === 'GAME_OVER') {
        await sleep(1500);
        const endFile = `${String(++shotIdx).padStart(2, '0')}-game-over-final.png`;
        await host.page.screenshot({ path: path.join(shotDir, endFile), fullPage: true });
        timeline.push({ t: Date.now() - started, phase: 'GAME_OVER_FINAL', file: endFile });
        break;
      }

      await Promise.all(
        seats.map(async (s) => {
          const now = Date.now();
          if (now - s.lastActAt < 400) return;
          try {
            const acted = await actForPolicy(s.page, s.policy, s.rng, thinkScale);
            if (acted) s.lastActAt = Date.now();
          } catch {
            // click races
          }
        }),
      );
      await sleep(250);
    }

    if (lastPhase !== 'GAME_OVER' && !timeline.some((x) => x.phase === 'GAME_OVER')) {
      throw new Error(`Did not reach GAME_OVER (last=${lastPhase})`);
    }

    fs.writeFileSync(
      path.join(outDir, 'timeline.json'),
      JSON.stringify(
        {
          roomCode,
          policies,
          thinkScale,
          durationMs: Date.now() - started,
          timeline,
        },
        null,
        2,
      ),
    );
    console.log('Done. Screenshots + timeline written.');
  } finally {
    // Close host last so video flushes.
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

    const videos = fs.existsSync(videoDir)
      ? fs.readdirSync(videoDir).filter((f) => f.endsWith('.webm'))
      : [];
    for (const v of videos) {
      const dest = path.join(outDir, 'host-seat.webm');
      fs.renameSync(path.join(videoDir, v), dest);
      console.log('Host video:', dest);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
