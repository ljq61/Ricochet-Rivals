/** Phase 17 desktop/mobile visual + real-input acceptance.
 * Run after npm run build: node scripts/art-acceptance.mjs
 * Screenshots: scripts/art-acceptance-output (ignored).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const OUT_DIR = 'scripts/art-acceptance-output';
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

let PORT = -1;
let URL = '';
let server = null;

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  throw new Error('未找到 Chrome/Edge');
}

function startPreview() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
      { stdio: ['ignore', 'ignore', 'ignore'] }
    );
    server = child;
    let settled = false;
    const probe = () => {
      fetch(URL)
        .then((r) => {
          if (r.ok) {
            settled = true;
            resolve();
          } else {
            setTimeout(probe, 300);
          }
        })
        .catch(() => {
          if (settled) return;
          setTimeout(probe, 300);
        });
    };
    child.on('exit', () => {
      if (!settled) {
        settled = true;
        reject(new Error('vite preview 意外退出'));
      }
    });
    probe();
  });
}

const dbg = (page) => page.evaluate(() => window.__RR_DEBUG__);

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitFor 超时: ${label} (last=${JSON.stringify(last)})`);
}

async function waitForScene(page, name, timeoutMs = 15000) {
  return waitFor(async () => (await dbg(page))?.scene === name, timeoutMs, `scene=${name}`);
}

async function tapMenuButton(page, key) {
  const rect = (await dbg(page)).buttons[key];
  if (!rect) throw new Error(`menu button not found: ${key}`);
  await page.touchscreen.touchStart(rect.x, rect.y);
  await page.touchscreen.touchEnd();
}

async function clickMenuButton(page, key) {
  const rect = (await dbg(page)).buttons[key];
  if (!rect) throw new Error(`menu button not found: ${key}`);
  await page.mouse.click(rect.x, rect.y);
}

function worldToScreen(world, viewportCssW, viewportCssH, d) {
  const ui = d.uiScale;
  const gameW = viewportCssW * ui;
  const gameH = viewportCssH * ui;
  const centerX = d.cameraScrollX + gameW / 2;
  const centerY = d.cameraScrollY + gameH / 2;
  return {
    x: ((world.x - centerX) * d.cameraZoom + gameW / 2) / ui,
    y: ((world.y - centerY) * d.cameraZoom + gameH / 2) / ui,
  };
}

/** 瞄准反向拖拽终点（屏幕 CSS px）：发射仰角 elevationDeg、发射水平向 dir（+1 右） */
function aimDragEnd(originScreen, d, elevationDeg, dir, dragWorld = 150) {
  const ui = d.uiScale;
  const rad = (elevationDeg * Math.PI) / 180;
  // 发射方向 = (dir·cosθ, −sinθ)（世界 y 向下）→ 拖拽反向
  const dragWorldX = -dir * dragWorld * Math.cos(rad);
  const dragWorldY = dragWorld * Math.sin(rad);
  return {
    x: originScreen.x + (dragWorldX * d.cameraZoom) / ui,
    y: originScreen.y + (dragWorldY * d.cameraZoom) / ui,
  };
}


const pause = (ms) => new Promise(r => setTimeout(r, ms));
async function inspect(browser, mobile) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const W = mobile ? 844 : 1280, H = mobile ? 390 : 800;
  await page.setViewport({ width: W, height: H, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  await page.goto(URL, { waitUntil: 'load' });
  await waitForScene(page, 'MainMenuScene');
  await pause(300);
  const prefix = mobile ? 'mobile' : 'desktop';
  await page.screenshot({ path: `${OUT_DIR}/${prefix}-menu.png` });
  await (mobile ? tapMenuButton : clickMenuButton)(page, 'local2p');
  await waitForScene(page, 'BattleScene');
  await waitFor(async () => (await dbg(page)).phase === 'ACTION', 10000, 'ACTION');
  await pause(400);
  await page.screenshot({ path: `${OUT_DIR}/${prefix}-battle.png` });
  // Click the visible button center, not a keyboard shortcut, to verify art/hit alignment.
  const buttonX = mobile ? W - 52 : W / 2;
  const buttonY = mobile ? H / 2 : H - 104;
  const tap = () => mobile ? page.touchscreen.tap(buttonX, buttonY) : page.mouse.click(buttonX, buttonY);
  await tap();
  await waitFor(async () => (await dbg(page)).cameraMode === 'AIMING', 3000, 'button enters AIMING');
  await page.screenshot({ path: `${OUT_DIR}/${prefix}-aim-cancel.png` });
  await tap();
  await waitFor(async () => (await dbg(page)).cameraMode === 'FREE_VIEW', 3000, 'button cancels AIMING');
  await tap();
  await waitFor(async () => (await dbg(page)).cameraMode === 'AIMING', 3000, 'reenter AIMING');
  const shoot = async (angle, dir, amount) => {
    const d = await dbg(page);
    const origin = worldToScreen({ x: d.players[d.currentPlayerId], y: 896 }, W, H, d);
    const drag = amount ?? 180 * (Math.sqrt(Math.abs(4550 - d.players[d.currentPlayerId]) * 1000) - 550) / 1850;
    const end = aimDragEnd(origin, d, angle, dir, drag);
    if (mobile) {
      await page.touchscreen.touchStart(origin.x, origin.y - 35);
      await page.touchscreen.touchMove(end.x, end.y);
      await pause(100);
      await page.touchscreen.touchEnd();
    } else {
      await page.mouse.move(origin.x, origin.y - 60);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 8 });
      await page.mouse.up();
    }
  };
  await shoot(45, 1);
  await waitFor(async () => (await dbg(page)).hasFired, 3000, 'shot fires');
  await pause(300);
  await page.screenshot({ path: `${OUT_DIR}/${prefix}-trail.png` });
  await waitFor(async () => (await dbg(page)).cameraMode === 'IMPACT', 6000, 'platform impact');
  await pause(100);
  await page.screenshot({ path: `${OUT_DIR}/${prefix}-explosion.png` });
  await waitFor(async () => (await dbg(page)).currentPlayerId === 'P2' && (await dbg(page)).phase === 'ACTION', 7000, 'next turn');
  await pause(1300);
  await page.screenshot({ path: `${OUT_DIR}/${prefix}-red-base.png` });
  if ((await dbg(page)).hp.P2 !== 8) throw new Error('Expected direct-hit damage and HP animation 10 -> 8');
  await tap();
  await waitFor(async () => (await dbg(page)).cameraMode === 'AIMING', 3000, 'P2 aim');
  await shoot(45, -1, 60);
  await waitFor(async () => (await dbg(page)).turnId === 3 && (await dbg(page)).phase === 'ACTION', 8000, 'sea miss resolves');
  const missed = await dbg(page);
  if (missed.hp.P1 !== 10 || missed.hp.P2 !== 8 || !missed.cameraEventLog.some(e => e.includes('2:outOfBounds'))) {
    throw new Error('Sea miss must leave HP unchanged and resolve through outOfBounds');
  }
  // Stage only the HP for a quick RESULT visual check; full natural kills are covered by e2e.mjs.
  await page.evaluate(() => window.__RR_DEBUG__.setHp('P2', 2));
  await tap();
  await waitFor(async () => (await dbg(page)).cameraMode === 'AIMING', 3000, 'P1 final aim');
  await shoot(45, 1);
  await waitForScene(page, 'ResultScene', 12000);
  await pause(300);
  await page.screenshot({ path: `${OUT_DIR}/${prefix}-result.png` });
  await (mobile ? tapMenuButton : clickMenuButton)(page, 'mainMenu');
  await waitForScene(page, 'MainMenuScene');
  await (mobile ? tapMenuButton : clickMenuButton)(page, 'online');
  await waitForScene(page, 'OnlineConnectionScene');
  await pause(300);
  await page.screenshot({ path: `${OUT_DIR}/${prefix}-online.png` });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`${prefix}: aim enter/cancel/fire/impact/HP/sea miss/result/online passed, no page errors`);
  await page.close();
}
async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  PORT = 4336; URL = `http://127.0.0.1:${PORT}/`;
  await startPreview();
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  try { await inspect(browser, false); await inspect(browser, true); }
  finally { await browser.close(); server?.kill('SIGTERM'); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
