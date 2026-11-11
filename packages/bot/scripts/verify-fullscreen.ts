/**
 * Browser check: home must not offer fullscreen (name field needs the keyboard).
 * In-game the toggle is allowed; there are no text fields on those screens.
 *
 *   npx tsx packages/bot/scripts/verify-fullscreen.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function startVite(): Promise<{ url: string; child: ChildProcess }> {
  const port = 5173 + Math.floor(Math.random() * 200);
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(
    process.execPath,
    [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: path.join(ROOT, 'packages', 'web'),
      env: { ...process.env, VITE_SOCKET_URL: 'http://127.0.0.1:9' },
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
    await sleep(300);
  }
  child.kill();
  throw new Error('Vite failed to start');
}

async function main(): Promise<void> {
  const vite = await startVite();
  const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const failures: string[] = [];

  try {
    await page.goto(vite.url, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('display-name-input').waitFor({ state: 'visible', timeout: 15_000 });

    const toggleCount = await page.getByTestId('fullscreen-toggle').count();
    if (toggleCount !== 0) {
      failures.push('Fullscreen toggle is visible on home (must wait until in-game)');
    }

    const name = page.getByTestId('display-name-input');
    await name.click();
    await sleep(200);
    const afterTap = await page.evaluate(() => {
      const input = document.querySelector('[data-testid="display-name-input"]');
      return {
        focused: document.activeElement === input,
        native: Boolean(document.fullscreenElement),
      };
    });
    if (!afterTap.focused) {
      failures.push('Name field did not receive focus on first tap');
    }
    if (afterTap.native) {
      failures.push('Home unexpectedly entered native fullscreen');
    }

    console.log('home', { toggleCount, ...afterTap });
    if (failures.length > 0) {
      console.error('FAIL');
      for (const f of failures) console.error(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log('PASS — no home fullscreen; name field focused');
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
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
