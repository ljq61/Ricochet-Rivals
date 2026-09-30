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
  const menu = await dbg(page);
  if (menu.buttons.singlePlayer.width !== 244 || menu.buttons.sound.width !== 48) {
    throw new Error('Expected compact mode buttons and 48px utility icons');
  }
  const clickMenu = mobile ? tapMenuButton : clickMenuButton;
  await clickMenu(page, 'sound');
  if ((await dbg(page)).soundEnabled === menu.soundEnabled) throw new Error('Sound icon did not toggle');
  await clickMenu(page, 'sound');
  if ((await dbg(page)).soundEnabled !== menu.soundEnabled) throw new Error('Sound icon did not restore');
  if (!mobile && menu.buttons.fullscreen) {
    await clickMenu(page, 'fullscreen');
    await waitFor(() => page.evaluate(() => Boolean(document.fullscreenElement)), 3000, 'fullscreen icon enters');
    await clickMenu(page, 'fullscreen');
    await waitFor(() => page.evaluate(() => !document.fullscreenElement), 3000, 'fullscreen icon exits');
  }

  await (mobile ? tapMenuButton : clickMenuButton)(page, 'local2p');
  await waitForScene(page, 'BattleScene');
  await waitFor(async () => (await dbg(page)).phase === 'ACTION', 10000, 'ACTION');
  await pause(400);
  await page.screenshot({ path: `${OUT_DIR}/${prefix}-battle.png` });
  if (mobile) {
    const initial = await dbg(page);
    const sizes = initial.moveButtonSizes;
    if (sizes.hit / initial.uiScale < 48 ||
        Math.abs(sizes.visual - 180 * initial.cameraZoom * 0.82) > 1) {
      throw new Error('Movement art must be slightly smaller than the character with a 48px touch target');
    }
    if (Math.abs(initial.moveButtons.left.y - initial.moveButtons.right.y) > 1) {
      throw new Error('Blue-base movement buttons must stay aligned with the deck at this viewport');
    }
    const hold = async (direction, ms) => {
      const button = (await dbg(page)).moveButtons[direction];
      await page.touchscreen.touchStart(button.x, button.y);
      await pause(ms);
      await page.touchscreen.touchEnd();
      await pause(100);
    };
    await hold('right', 2100);
    const rightX = (await dbg(page)).players.P1;
    if (rightX - initial.players.P1 <= 250 || rightX > 850) {
      throw new Error(`Unlimited movement did not reach the right base boundary: ${rightX}`);
    }
    await hold('left', 3000);
    const leftX = (await dbg(page)).players.P1;
    if (rightX - leftX <= 700 || leftX < 100) {
      throw new Error(`Unlimited reversal stopped early or left the base: ${leftX}`);
    }
    await pause(200);
    if (Math.abs((await dbg(page)).players.P1 - leftX) > 0.5) throw new Error('Movement did not stop on release');
    console.log('mobile movement art: both holds/release passed, unlimited path >1000px, inside base');
  }
  // Click the visible button center, not a keyboard shortcut, to verify art/hit alignment.
  const tap = async () => {
    const d = await dbg(page);
    const { x, y } = d.aimButtonBounds;
    return mobile ? page.touchscreen.tap(x / d.uiScale, y / d.uiScale)
      : page.mouse.click(x / d.uiScale, y / d.uiScale);
  };
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
  if (mobile) {
    const buttons = (await dbg(page)).moveButtons;
    if (Math.abs(buttons.left.y - buttons.right.y) > 1) {
      throw new Error('Red-base movement buttons must stay aligned with the deck at this viewport');
    }
  }
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
  const onlineButtons = (await dbg(page)).buttons;
  const enterGap = onlineButtons.backToMenu.y - onlineButtons.enterBattle.y
    - (onlineButtons.backToMenu.height + onlineButtons.enterBattle.height) / 2;
  if (enterGap < 16) throw new Error(`Online ENTER/BACK buttons too close: ${enterGap}px`);
  await (mobile ? tapMenuButton : clickMenuButton)(page, 'join');
  await pause(150);
  await page.screenshot({ path: `${OUT_DIR}/${prefix}-online-join.png` });
  const joinButtons = (await dbg(page)).buttons;
  const inputRect = await page.evaluate(() => {
    const rect = document.querySelector('#online-code-input')?.getBoundingClientRect();
    return rect ? { top: rect.top, bottom: rect.bottom } : null;
  });
  if (!inputRect || inputRect.bottom + 10 > joinButtons.joinConfirm.y - joinButtons.joinConfirm.height / 2) {
    throw new Error('Online room-code input overlaps JOIN action');
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`${prefix}: aim enter/cancel/fire/impact/HP/sea miss/result/online passed, no page errors`);
  await page.close();
}
async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  PORT = 4336; URL = `http://127.0.0.1:${PORT}/`;
  await startPreview();
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  try {
    await inspect(browser, false);
    await inspect(browser, true);
    for (const [width, height] of [[667, 320], [780, 360], [900, 520]]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await page.goto(URL, { waitUntil: 'load' });
      await waitForScene(page, 'MainMenuScene');
      await tapMenuButton(page, 'online');
      await waitForScene(page, 'OnlineConnectionScene');
      const initial = await dbg(page);
      const createTop = initial.buttons.create.y - initial.buttons.create.height / 2;
      if (createTop < initial.textRects.status.bottom + 12 ||
          initial.buttons.join.y + initial.buttons.join.height / 2 > height - 8) {
        throw new Error(`Online buttons overlap copy or viewport at ${width}x${height}`);
      }
      await tapMenuButton(page, 'join');
      await pause(100);
      const joined = await dbg(page);
      const input = await page.evaluate(() => {
        const r = document.querySelector('#online-code-input')?.getBoundingClientRect();
        return r ? { top: r.top, bottom: r.bottom } : null;
      });
      if (!input || input.top < joined.textRects.prompt.bottom + 8 ||
          input.bottom + 10 > joined.buttons.joinConfirm.y - joined.buttons.joinConfirm.height / 2) {
        throw new Error(`Online JOIN layout overlaps at ${width}x${height}`);
      }
      await page.screenshot({ path: `${OUT_DIR}/mobile-online-join-${width}x${height}.png` });
      await page.close();
    }
  }
  finally { await browser.close(); server?.kill('SIGTERM'); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
