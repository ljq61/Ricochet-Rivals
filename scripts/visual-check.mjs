/**
 * Phase 17 修复轮视觉抽查（截图，非断言）：
 * ① 手机 Online 连接页 —— 返回 icon 移左上角后不再与动作行重叠
 * ② Local 2P 瞄准抬枪姿态 —— 45° / 75° 仰角序列图 + 朝向翻转（15° 向左）
 * ③ 炮弹飞行视觉尺寸（displaySize 165 → 可见 ~60 世界 px）
 *
 * 运行前置：npm run build（服务 dist 产物）。
 * 运行方式：node scripts/visual-check.mjs
 * 输出：scripts/visual-output/*.png（配合多模态复查）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const OUT_DIR = 'scripts/visual-output';
const PORT_CANDIDATES = [4331, 4333];
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];
const GROUND_TOP_Y = 960;
const LAUNCHER_OFFSET_Y = -64;
const MAX_DRAG = 180;

let PORT = -1;
let URL = '';
let server = null;

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  throw new Error('未找到 Chrome/Edge');
}

async function isPortFree(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`);
    return false;
  } catch {
    return true;
  }
}

function startPreview() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
      { shell: true, stdio: ['ignore', 'ignore', 'ignore'] }
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

async function shotOnlineBackIcon(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: 'load' });
  await waitForScene(page, 'MainMenuScene');
  await tapMenuButton(page, 'online');
  await waitForScene(page, 'OnlineConnectionScene');
  // HOST 页：动作行（CONNECT/COPY）+ 左上角返回 icon 同屏
  await clickMenuButton(page, 'create');
  await waitFor(async () => (await dbg(page)).state === 'HOST_WAITING_FOR_ANSWER', 15000, 'HOST_WAITING_FOR_ANSWER');
  await page.screenshot({ path: `${OUT_DIR}/01-online-back-icon-mobile.png` });
  await page.close();
}

async function shotAimPoses(browser) {
  const W = 1280;
  const H = 800;
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  await page.goto(URL, { waitUntil: 'load' });
  await waitForScene(page, 'MainMenuScene');
  await clickMenuButton(page, 'local2p');
  await waitForScene(page, 'BattleScene');
  await waitFor(async () => (await dbg(page)).phase === 'ACTION', 15000, 'phase=ACTION');

  await page.keyboard.press('Space');
  await waitFor(async () => (await dbg(page)).cameraMode === 'AIMING', 3000, 'AIMING');

  const d = await dbg(page);
  const playerX = d.players[d.currentPlayerId];
  const origin = worldToScreen({ x: playerX, y: GROUND_TOP_Y + LAUNCHER_OFFSET_Y }, W, H, d);
  // 起点统一上移 60 CSS px（AimButton zone 重叠防御，同 E2E）
  const startX = origin.x;
  const startY = origin.y - 60;

  // ① 45° 向右：中弧抬枪
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const p45 = aimDragEnd(origin, d, 45, 1);
  await page.mouse.move(p45.x, p45.y, { steps: 6 });
  await page.screenshot({ path: `${OUT_DIR}/02-aim-pose-45-right.png` });

  // ② 75° 向右：近垂直抬枪（保持按住，直接改拖点）
  const p75 = aimDragEnd(origin, d, 75, 1);
  await page.mouse.move(p75.x, p75.y, { steps: 6 });
  await page.screenshot({ path: `${OUT_DIR}/03-aim-pose-75-right.png` });

  // ③ 15° 向左：低弧 + 朝向翻转
  const p15L = aimDragEnd(origin, d, 15, -1);
  await page.mouse.move(p15L.x, p15L.y, { steps: 6 });
  await page.screenshot({ path: `${OUT_DIR}/04-aim-pose-15-left-flip.png` });

  // ④ 释放（45° 向右满拖 → 炮弹飞行视觉尺寸）
  await page.mouse.move(p45.x, p45.y, { steps: 6 });
  await page.mouse.up();
  await waitFor(async () => (await dbg(page)).hasFired, 3000, 'hasFired');
  await new Promise((r) => setTimeout(r, 350));
  await page.screenshot({ path: `${OUT_DIR}/05-projectile-flight.png` });
  // 06：弹道末段（相机跟随至 P2 阵地 —— 红方基地甲板对齐抽查）
  await new Promise((r) => setTimeout(r, 2200));
  await page.screenshot({ path: `${OUT_DIR}/06-red-base-follow.png` });
  await page.close();
}

async function main() {
  if (!existsSync('dist/index.html')) {
    console.error('dist/ 不存在 —— 请先运行 npm run build');
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  for (const candidate of PORT_CANDIDATES) {
    if (await isPortFree(candidate)) {
      PORT = candidate;
      break;
    }
  }
  if (PORT < 0) throw new Error(`候选端口 ${PORT_CANDIDATES.join('/')} 均被占用`);
  URL = `http://127.0.0.1:${PORT}/`;
  await startPreview();

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  try {
    await shotOnlineBackIcon(browser);
    await shotAimPoses(browser);
    console.log(`视觉抽查截图完成 → ${OUT_DIR}/`);
  } finally {
    await browser.close().catch(() => {});
    server?.kill('SIGTERM');
  }
}

main();
