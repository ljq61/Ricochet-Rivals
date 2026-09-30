/**
 * Phase 6.5 E2E 验证脚本（Desktop Mouse+Keyboard 与 Mobile Touch 两套操作）。
 * Phase 9：Desktop 场景升级为自然完整对局（满血互射到自然击杀，
 * 无 HP 注入）+ 回合横幅 / 胜负横幅断言。
 * Phase 10：新增 Single Player 冒烟场景（AI 自动开火、人类输入
 * 静默 / 恢复、回合循环 P1→AI→P1）。
 * Phase 11：入口改为 Main Menu（scene 流：Menu→Battle→Result→
 * Rematch/Menu）；按钮坐标来自各场景 debug 句柄（CSS 口径）。
 *
 * 运行前置：npm run build（脚本用 vite preview 服务 dist 产物）。
 * 运行方式：npm run e2e（node scripts/e2e.mjs）
 *
 * 使用 puppeteer-core + 系统 Chrome/Edge（无浏览器下载）。
 * 断言数据来自 window.__RR_DEBUG__（DebugConfig.DEBUG_GAME=true 时安装）。
 *
 * 屏幕坐标换算（相机 zoom 围绕视口中心缩放）：
 *   screenX = (worldX − centerX) · zoom + viewportWidth / 2
 *   centerX = scrollX + viewportWidth / 2
 */

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const PORT_CANDIDATES = [4319, 4321, 4322, 4323];
let PORT = 4319;
let URL = '';

const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

const GROUND_TOP_Y = 960;
const LAUNCHER_OFFSET_Y = -64;

// ---- 微型断言工具 --------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name) {
  console.log(`\n=== ${name} ===`);
}

async function waitFor(page, fn, timeoutMs = 10000, label = 'condition') {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`waitFor 超时: ${label} (last=${JSON.stringify(last)})`);
}

const dbg = (page) => page.evaluate(() => window.__RR_DEBUG__);

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Phase 11 场景流 helpers --------------------------------------------

/** 等待某个活动场景（各场景 installDebugHandles 提供 scene 字段）；
 *  超时信息携带实际 scene 值便于诊断 */
async function waitForScene(page, name, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const d = await dbg(page);
    if (d?.scene === name) {
      return true;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `waitFor 超时: scene=${name} (last=${d ? String(d.scene) : 'no-handle'})`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** 鼠标点击当前场景 debug 句柄里的按钮（坐标为 CSS 口径） */
async function clickMenuButton(page, key) {
  const rect = (await dbg(page)).buttons[key];
  if (!rect) {
    throw new Error(`menu button not found: ${key}`);
  }
  await page.mouse.click(rect.x, rect.y);
}

/** 触摸点击当前场景 debug 句柄里的按钮 */
async function tapMenuButton(page, key) {
  const rect = (await dbg(page)).buttons[key];
  if (!rect) {
    throw new Error(`menu button not found: ${key}`);
  }
  await page.touchscreen.touchStart(rect.x, rect.y);
  await page.touchscreen.touchEnd();
}

/**
 * 世界坐标 → 屏幕坐标（CSS px，可直接注入 pointer 事件）。
 * 游戏坐标空间 = 物理像素（gameSize = CSS × DPR）：
 * 相机 scroll/zoom 均为物理口径，输出除以 uiScale 回到 CSS px。
 * DPR 1（桌面）时为恒等变换。
 */
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

async function launchOriginScreen(page, viewportCssW, viewportCssH) {
  const d = await dbg(page);
  const playerX = d.players[d.currentPlayerId];
  return worldToScreen(
    { x: playerX, y: GROUND_TOP_Y + LAUNCHER_OFFSET_Y },
    viewportCssW,
    viewportCssH,
    d
  );
}

/**
 * 弹道求解（45°，方向自适应）：
 * 45° 射程 R = v²/g → v = √(R·g)；power = (v − min)/range；
 * 反向拖拽终点 = 炮塔 + 目标反方向 45° 屏幕分量（世界拖拽 × zoom / √2，
 * 再 ÷ uiScale 回 CSS px）。
 * 命中点会因 Matter 半隐式积分轻微过冲（<1%），仍在直伤半径内。
 */
function solveFortyFiveRelease(origin, d, targetWorldX) {
  const GRAVITY = 1000;
  const MIN_SPEED = 550;
  const MAX_SPEED = 2400;
  const MAX_DRAG = 180;
  const shooterX = d.players[d.currentPlayerId];
  const direction = Math.sign(targetWorldX - shooterX); // +1 右 / −1 左
  const range = Math.abs(targetWorldX - shooterX);
  const speed = Math.sqrt(Math.max(1, range * GRAVITY));
  const power = Math.min(
    1,
    Math.max(0, (speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED))
  );
  // 游戏像素口径的拖拽分量 → CSS px 注入
  const dragCss = (MAX_DRAG * power * d.cameraZoom) / Math.SQRT2 / d.uiScale;
  // Angry Birds 反向拖拽：向目标反方向拖拽
  return { x: origin.x - dragCss * direction, y: origin.y + dragCss };
}

/**
 * 完整开火流程（Phase 9 自然对局循环用）：
 * Space 瞄准 → 45° 求解反向拖拽 → 释放 → 等待 FireCommand 生效。
 * 拖拽起点上移 60 CSS px：炮手靠近视口左边界时相机中心被 clamp（864），
 * 炮塔屏幕位置可能与 AimButton zone 重叠 —— 起点偏移避开按钮，
 * 仍在 220 世界 px 起始半径内；瞄准向量按「指针 − 炮塔」计算，
 * 起点偏移不影响力度 / 方向（与 Mobile 流程同一套防御）。
 */
async function fireFortyFiveShot(page, viewportCssW, viewportCssH, targetWorldX) {
  await page.keyboard.press('Space');
  await waitFor(
    page,
    async () => (await dbg(page)).cameraMode === 'AIMING',
    1500,
    'AIMING'
  );
  const origin = await launchOriginScreen(page, viewportCssW, viewportCssH);
  const shot = solveFortyFiveRelease(origin, await dbg(page), targetWorldX);
  await page.mouse.move(origin.x, origin.y - 60);
  await page.mouse.down();
  await page.mouse.move(shot.x, shot.y, { steps: 6 });
  await page.mouse.up();
  await waitFor(
    page,
    async () => (await dbg(page)).hasFired,
    3000,
    'hasFired'
  );
}

// ---- 服务器 --------------------------------------------------------------

/** 端口占用探测：连接失败 = 空闲 */
async function isPortFree(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`);
    return false;
  } catch {
    return true;
  }
}

async function startPreview() {
  if (!existsSync('dist/index.html')) {
    console.error('dist/ 不存在 —— 请先运行 npm run build');
    process.exit(1);
  }
  PORT = -1;
  for (const candidate of PORT_CANDIDATES) {
    if (await isPortFree(candidate)) {
      PORT = candidate;
      break;
    }
  }
  if (PORT < 0) {
    throw new Error(`候选端口 ${PORT_CANDIDATES.join('/')} 均被占用`);
  }
  URL = `http://127.0.0.1:${PORT}/`;

  const child = spawn(
    'npx',
    [
      'vite', 'preview',
      '--port', String(PORT),
      '--strictPort',
      // 显式绑定 IPv4：Windows 上默认 localhost 可能只绑 ::1，
      // 导致 127.0.0.1 连接被拒
      '--host', '127.0.0.1',
    ],
    { shell: true, stdio: ['ignore', 'ignore', 'ignore'] }
  );
  const stop = () => {
    if (process.platform === 'win32' && child.pid) {
      // shell:true 时 kill 只杀 cmd 包装层；同步按进程树杀干净
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: true });
    } else {
      child.kill();
    }
  };
  return new Promise((resolve, reject) => {
    let settled = false;
    const started = Date.now();
    const probe = async () => {
      try {
        const response = await fetch(URL);
        if (response.ok) {
          settled = true;
          resolve(stop);
          return;
        }
      } catch {
        // 未就绪，继续探测
      }
      if (Date.now() - started > 20000) {
        settled = true;
        reject(new Error('vite preview 就绪探测超时'));
        return;
      }
      setTimeout(probe, 300);
    };
    // exit 处理必须在 promise 作用域内（reject 捕获正确）
    child.on('exit', () => {
      if (!settled) {
        settled = true;
        reject(new Error('vite preview 意外退出'));
      }
    });
    probe();
  });
}

// ---- Desktop 场景 --------------------------------------------------------

async function runDesktop(browser) {
  section('Desktop — Mouse + Keyboard（1280×800，无触摸）');

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'load' });

  // Phase 11：主菜单入口（Boot → MainMenu）
  await waitForScene(page, 'MainMenuScene', 15000);
  const menu = await dbg(page);
  check(
    '主菜单：三模式 + Sound 按钮就绪',
    menu.buttons.singlePlayer &&
      menu.buttons.local2p &&
      menu.buttons.online &&
      menu.buttons.sound,
    `buttons=${Object.keys(menu.buttons).join(',')}`
  );

  // Sound 开关（UserSettings 翻转，Scene 切换间保持）
  await clickMenuButton(page, 'sound');
  check('Sound 开关：点击后 OFF', (await dbg(page)).soundEnabled === false);
  await clickMenuButton(page, 'sound');
  check('Sound 开关：再次点击 ON', (await dbg(page)).soundEnabled === true);

  // ONLINE → 连接场景（Phase 13 手动配对 UI）→ BACK 回菜单
  // （真实双页 WebRTC 配对见 runOnlineP2P 场景）
  await clickMenuButton(page, 'online');
  await waitForScene(page, 'OnlineConnectionScene', 5000);
  check('ONLINE → OnlineConnectionScene（CREATE / JOIN / BACK）', true);
  await clickMenuButton(page, 'back');
  await waitForScene(page, 'MainMenuScene', 5000);
  check('BACK → 返回主菜单', true);

  // LOCAL 2 PLAYER → BattleScene
  await clickMenuButton(page, 'local2p');
  await waitForScene(page, 'BattleScene', 10000);
  const d0 = await dbg(page);

  check('控制档位 = desktop（fine pointer + hover，无 UA 判断）', d0.controlProfile === 'desktop');
  check('初始模式 FREE_VIEW', d0.cameraMode === 'FREE_VIEW');
  const cssSize = await page.evaluate(() => ({
    w: document.querySelector('canvas').clientWidth,
    h: document.querySelector('canvas').clientHeight,
  }));
  check(
    '画布 CSS 尺寸 = 视口（手动布局写入，防样式滞留压扁）',
    cssSize.w === 1280 && cssSize.h === 800,
    `css=${cssSize.w}x${cssSize.h}`
  );
  check(
    '动态 zoom = viewportHeight/1080 ≈ 0.741（纵向构图稳定）',
    Math.abs(d0.cameraZoom - 800 / 1080) < 0.01,
    `zoom=${d0.cameraZoom}`
  );

  // Phase 9：开局回合横幅（真人热座可见，不再只有 DebugOverlay）
  const banner0 = await waitFor(
    page,
    async () => (await dbg(page)).turnBanner.visible === true,
    3000,
    '开局横幅可见'
  );
  const banner0Text = (await dbg(page)).lastBannerText;
  check(
    '开局横幅：P1 · 第 1 回合',
    banner0 === true && banner0Text === 'P1 · 第 1 回合',
    `text="${banner0Text}"`
  );

  // 1. 鼠标拖动相机（反向拖拽惯例：鼠标向左 → 画面向右）
  const beforeDrag = d0.cameraScrollX;
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(440, 400, { steps: 4 });
  await page.mouse.up();
  await sleep(150);
  const afterDrag = (await dbg(page)).cameraScrollX;
  const expectedDelta = (200 * d0.uiScale) / d0.cameraZoom;
  check(
    '鼠标拖动平移相机（Δ ≈ clientΔ × DPR / zoom ≈ +270）',
    Math.abs(afterDrag - beforeDrag - expectedDelta) < 15,
    `Δ=${(afterDrag - beforeDrag).toFixed(1)}`
  );

  // 2. 键盘 A/D 移动
  const xBefore = (await dbg(page)).players.P1;
  await page.keyboard.down('d');
  await sleep(400);
  await page.keyboard.up('d');
  const xAfter = (await dbg(page)).players.P1;
  check('按住 D 向右移动（Gameplay 世界坐标不变）', xAfter - xBefore > 80, `Δx=${(xAfter - xBefore).toFixed(1)}`);

  // 3. Space 发起瞄准：FREE_VIEW → RETURN_HOME → AIMING
  await page.keyboard.press('Space');
  await waitFor(
    page,
    async () => (await dbg(page)).cameraMode === 'AIMING',
    1500,
    'AIMING'
  );
  check('Space → RETURN_HOME → AIMING', true);

  // 4. Escape 取消瞄准
  await page.keyboard.press('Escape');
  await waitFor(
    page,
    async () => (await dbg(page)).cameraMode === 'FREE_VIEW',
    1000,
    'FREE_VIEW'
  );
  check('Escape 取消 → FREE_VIEW', true);

  // 4.5 Phase 9 Review Gate：点击瞄准按钮后位置锁定（AIMING 中 A/D 无效），
  //     取消瞄准回 ACTION 后移动恢复（剩余预算继续可用）
  await page.keyboard.press('Space');
  await waitFor(
    page,
    async () => (await dbg(page)).cameraMode === 'AIMING',
    1500,
    'AIMING'
  );
  const lockBefore = (await dbg(page)).players.P1;
  await page.keyboard.down('d');
  await sleep(400);
  await page.keyboard.up('d');
  const lockAfter = (await dbg(page)).players.P1;
  check(
    'AIMING 中位置锁定（按住 D 不动）',
    lockAfter === lockBefore,
    `x: ${lockBefore.toFixed(1)} → ${lockAfter.toFixed(1)}`
  );
  await page.keyboard.press('Escape');
  await waitFor(
    page,
    async () => (await dbg(page)).cameraMode === 'FREE_VIEW',
    1000,
    'FREE_VIEW'
  );
  const restoreBefore = (await dbg(page)).players.P1;
  await page.keyboard.down('d');
  await sleep(400);
  await page.keyboard.up('d');
  const restoreAfter = (await dbg(page)).players.P1;
  check(
    '取消瞄准回 ACTION，移动恢复',
    restoreAfter - restoreBefore > 80,
    `Δx=${(restoreAfter - restoreBefore).toFixed(1)}`
  );

  // 5. 鼠标 Angry Birds 拖拽 → 发射 → PROJECTILE_FOLLOW → IMPACT → FREE_VIEW
  //    拖拽经 45° 弹道求解，直接命中 P2（验证完整伤害链路）
  check(
    '发射前双方 HP 满血',
    d0.hp.P1 === 10 && d0.hp.P2 === 10 && d0.gameOver === false
  );
  await page.keyboard.press('Space');
  await waitFor(
    page,
    async () => (await dbg(page)).cameraMode === 'AIMING',
    1500,
    'AIMING'
  );

  const origin = await launchOriginScreen(page, 1280, 800);
  const shot = solveFortyFiveRelease(origin, await dbg(page), 4550);
  // 起点上移 60px 避开 AimButton zone（见 fireFortyFiveShot 注释）
  await page.mouse.move(origin.x, origin.y - 60);
  await page.mouse.down();
  await page.mouse.move(shot.x, shot.y, { steps: 6 });
  await page.mouse.up();

  const fired = await waitFor(
    page,
    async () => (await dbg(page)).hasFired,
    3000,
    'hasFired'
  );
  check('拖拽释放 → FireCommand（hasFired）', fired);
  const inFlight = await dbg(page);
  check('发射后相机 PROJECTILE_FOLLOW', inFlight.cameraMode === 'PROJECTILE_FOLLOW', `mode=${inFlight.cameraMode}`);
  check('炮弹已生成', inFlight.projectileCount >= 1);

  const resolved = await waitFor(
    page,
    async () => (await dbg(page)).cameraMode === 'FREE_VIEW',
    12000,
    '攻击结束回 FREE_VIEW'
  );
  check('命中 → IMPACT 停留 → 攻击结束回 FREE_VIEW', resolved === true);

  // Phase 7：DamageSystem 结算验证（ExplosionEvent → DamageResult → GameState）
  const endState = await dbg(page);
  check(
    '命中结算：P2 直伤 2 点（10 → 8，伤害链路完整）',
    endState.hp.P2 === 8,
    `P2 hp=${endState.hp.P2}`
  );
  check('P1 未受伤（远离爆炸）', endState.hp.P1 === 10, `P1 hp=${endState.hp.P1}`);
  check(
    'P2 存活、游戏未结束',
    endState.gameOver === false && endState.hp.P2 > 0
  );

  // Phase 8：回合切换（P1 → P2，相机 TURN_TRANSITION 完成后回 FREE_VIEW）
  const turn2 = await dbg(page);
  check(
    '回合切换：turnId 1→2、当前玩家 P2、phase ACTION',
    turn2.turnId === 2 &&
      turn2.currentPlayerId === 'P2' &&
      turn2.phase === 'ACTION',
    `turn=${turn2.turnId} player=${turn2.currentPlayerId} phase=${turn2.phase}`
  );
  // Phase 9：回合切换横幅（waitFor 消除一帧竞态：FREE_VIEW 先于 banner 一帧）
  const turn2Banner = await waitFor(
    page,
    async () => {
      const t = (await dbg(page)).lastBannerText;
      return t === 'P2 · 第 2 回合' ? t : null;
    },
    3000,
    'P2 回合横幅'
  );
  check('回合切换横幅：P2 · 第 2 回合', turn2Banner === 'P2 · 第 2 回合');

  // 热座：键盘输入跟随当前玩家 —— 按住 D 移动的是 P2
  const p2Before = (await dbg(page)).players.P2;
  await page.keyboard.down('d');
  await sleep(400);
  await page.keyboard.up('d');
  const p2After = (await dbg(page)).players.P2;
  check(
    '热座输入跟随：P2 回合键盘控制 P2 移动',
    p2After - p2Before > 80,
    `Δx=${(p2After - p2Before).toFixed(1)}`
  );

  // P2 开火回击 P1（45° 左向求解 → 命中 P1）
  await page.keyboard.press('Space');
  await waitFor(
    page,
    async () => (await dbg(page)).cameraMode === 'AIMING',
    1500,
    'AIMING'
  );
  const origin2 = await launchOriginScreen(page, 1280, 800);
  const targetP1 = (await dbg(page)).players.P1;
  const shot2 = solveFortyFiveRelease(origin2, await dbg(page), targetP1);
  // 起点上移 60px 避开 AimButton zone（见 fireFortyFiveShot 注释）
  await page.mouse.move(origin2.x, origin2.y - 60);
  await page.mouse.down();
  await page.mouse.move(shot2.x, shot2.y, { steps: 6 });
  await page.mouse.up();
  await waitFor(
    page,
    async () => (await dbg(page)).hasFired,
    3000,
    'hasFired(P2)'
  );
  await waitFor(
    page,
    async () => (await dbg(page)).cameraMode === 'FREE_VIEW',
    12000,
    'P2 攻击结束'
  );
  const afterP2Shot = await dbg(page);
  check(
    'P2 回击命中：P1 直伤 2 点（10 → 8）',
    afterP2Shot.hp.P1 === 8,
    `P1 hp=${afterP2Shot.hp.P1}`
  );
  check(
    '回合再次切换：turnId 3、回到 P1、phase ACTION',
    afterP2Shot.turnId === 3 &&
      afterP2Shot.currentPlayerId === 'P1' &&
      afterP2Shot.phase === 'ACTION',
    `turn=${afterP2Shot.turnId} player=${afterP2Shot.currentPlayerId}`
  );

  // Phase 9 Gate：自然完整对局 —— 移除 HP 注入，双方 45° 互射直到自然击杀。
  // 直伤 2 点/发：P1 10→8→6→4→2（吃 4 发）；P2 10→8→6→4→2→0（第 9 回合完成击杀）。
  const expectedHp = { P1: 8, P2: 8 };
  for (let shot = 3; shot <= 9; shot++) {
    const before = await dbg(page);
    const shooter = before.currentPlayerId;
    const enemy = shooter === 'P1' ? 'P2' : 'P1';
    const next = shooter === 'P1' ? 'P2' : 'P1';
    await fireFortyFiveShot(page, 1280, 800, before.players[enemy]);

    // 等待攻击结算 + 回合推进 + 新回合横幅（击杀发则等待 GAME_OVER + FREE_VIEW）
    const after = await waitFor(
      page,
      async () => {
        const s = await dbg(page);
        if (s.cameraMode !== 'FREE_VIEW') {
          return null;
        }
        if (s.gameOver) {
          return s;
        }
        return s.turnId === shot + 1 &&
          s.currentPlayerId === next &&
          s.lastBannerText === `${next} · 第 ${shot + 1} 回合`
          ? s
          : null;
      },
      15000,
      `第 ${shot} 发结算 + 回合推进`
    );

    expectedHp[enemy] -= 2;
    check(
      `第 ${shot} 回合 ${shooter} 直伤命中：${enemy} HP → ${expectedHp[enemy]}`,
      after.hp[enemy] === expectedHp[enemy],
      `${enemy} hp=${after.hp[enemy]}`
    );
    if (after.gameOver) {
      break;
    }
    check(
      `循环推进：turn ${shot} → ${after.turnId}、当前玩家 ${next}、横幅「${next} · 第 ${shot + 1} 回合」`,
      after.turnId === shot + 1 && after.currentPlayerId === next,
      `turn=${after.turnId} player=${after.currentPlayerId}`
    );
  }

  // 自然击杀收口：P1 以 2 HP 获胜
  const gameOverState = await dbg(page);
  check(
    '自然击杀 → 游戏结束（gameOver + GAME_OVER + winnerId P1）',
    gameOverState.gameOver === true &&
      gameOverState.phase === 'GAME_OVER' &&
      gameOverState.winnerId === 'P1',
    `gameOver=${gameOverState.gameOver} phase=${gameOverState.phase} winner=${gameOverState.winnerId}`
  );
  check(
    '终局血量：P2 = 0、P1 = 2（全程无注入）',
    gameOverState.hp.P2 === 0 && gameOverState.hp.P1 === 2,
    `P1=${gameOverState.hp.P1} P2=${gameOverState.hp.P2}`
  );
  check(
    '游戏结束不切换回合（仍为 P1 / turn 9）',
    gameOverState.currentPlayerId === 'P1' && gameOverState.turnId === 9,
    `player=${gameOverState.currentPlayerId} turn=${gameOverState.turnId}`
  );
  const winnerBanner = await waitFor(
    page,
    async () => {
      const s = await dbg(page);
      return s.turnBanner.visible && s.lastBannerText === 'P1 获胜！'
        ? s
        : null;
    },
    3000,
    '胜负横幅'
  );
  check(
    '胜负横幅持久显示：P1 获胜！',
    winnerBanner !== null,
    `text="${(await dbg(page)).lastBannerText}"`
  );

  // Phase 11：对局结束 → ResultScene（胜负横幅停留 ~1.6s 后淡出转场）
  await waitForScene(page, 'ResultScene', 8000);
  const result = await dbg(page);
  check(
    'ResultScene：PLAYER 1 WINS（Local 2P 文案）',
    result.resultText === 'PLAYER 1 WINS',
    `text="${result.resultText}"`
  );
  await clickMenuButton(page, 'mainMenu');
  await waitForScene(page, 'MainMenuScene', 5000);
  check('Result → MAIN MENU 返回主菜单', true);

  await page.close();
}

// ---- Mobile 场景 --------------------------------------------------------

async function runMobile(browser) {
  section('Mobile — Touch（844×390 landscape，触摸模拟）');

  const page = await browser.newPage();
  await page.setViewport({
    width: 844,
    height: 390,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(URL, { waitUntil: 'load' });

  // Phase 11：触屏菜单入口（按钮坐标 = debug 句柄 CSS 口径 ÷ DPR 换算后）
  await waitForScene(page, 'MainMenuScene', 15000);
  check(
    '触屏主菜单：按钮为 CSS 口径坐标（句柄已 ÷uiScale）',
    (await dbg(page)).buttons.local2p.width >= 56,
    `w=${(await dbg(page)).buttons.local2p.width}`
  );
  await tapMenuButton(page, 'local2p');
  await waitForScene(page, 'BattleScene', 10000);
  const d0 = await dbg(page);
  check('控制档位 = touch（coarse pointer / 不可悬停）', d0.controlProfile === 'touch');
  check(
    `UI 缩放 = DPR 2（游戏坐标 = 物理像素）`,
    d0.uiScale === 2,
    `uiScale=${d0.uiScale}`
  );
  check(
    '画布位图 = CSS × DPR（高分屏清晰渲染，不再被浏览器拉伸）',
    (await page.evaluate(() => document.querySelector('canvas').width)) ===
      844 * 2,
  );
  const cssSize = await page.evaluate(() => ({
    w: document.querySelector('canvas').clientWidth,
    h: document.querySelector('canvas').clientHeight,
  }));
  check(
    '画布 CSS 尺寸 = 视口（手动布局写入）',
    cssSize.w === 844 && cssSize.h === 390,
    `css=${cssSize.w}x${cssSize.h}`
  );
  check(
    '动态 zoom = (390×DPR)/1080 ≈ 0.722（物理像素口径，构图恒定）',
    Math.abs(d0.cameraZoom - (390 * d0.uiScale) / 1080) < 0.005,
    `zoom=${d0.cameraZoom}`
  );
  check('方向判定 landscape', d0.orientation === 'landscape');
  const overlayHidden = await page.evaluate(
    () => !document.getElementById('rotate-overlay').classList.contains('is-visible')
  );
  check('横屏时旋转提示隐藏', overlayHidden);

  // Phase 9：开局回合横幅（触屏档位同样对真人可见）
  const mBanner0 = await waitFor(
    page,
    async () => (await dbg(page)).turnBanner.visible === true,
    3000,
    '开局横幅可见'
  );
  const mBanner0Text = (await dbg(page)).lastBannerText;
  check(
    '开局横幅：P1 · 第 1 回合',
    mBanner0 === true && mBanner0Text === 'P1 · 第 1 回合',
    `text="${mBanner0Text}"`
  );

  // 1. 单指拖动相机
  const beforeCam = d0.cameraScrollX;
  await page.touchscreen.touchStart(600, 200);
  await page.touchscreen.touchMove(500, 200);
  await page.touchscreen.touchEnd();
  await sleep(150);
  const afterCam = (await dbg(page)).cameraScrollX;
  // 世界位移 = client Δ × uiScale / zoom（游戏坐标 = 物理像素）
  const expectedCam = (100 * d0.uiScale) / d0.cameraZoom;
  check(
    '单指拖动平移相机（Δ ≈ clientΔ × DPR / zoom）',
    Math.abs(afterCam - beforeCam - expectedCam) < 15,
    `Δ=${(afterCam - beforeCam).toFixed(1)}`
  );

  // 2. 按住 ◀ 移动按钮（跟随当前基地；点击画面实际显示位置）
  const xBefore = (await dbg(page)).players.P1;
  const moveLeft = (await dbg(page)).moveButtons.left;
  await page.touchscreen.touchStart(moveLeft.x, moveLeft.y);
  await sleep(500);
  await page.touchscreen.touchEnd();
  await sleep(100);
  const xReleased = (await dbg(page)).players.P1;
  check('按住 ◀ 向左移动', xReleased < xBefore - 60, `x: ${xBefore.toFixed(0)} → ${xReleased.toFixed(0)}`);
  // 松开后：等待一轮再比较，排除释放指令的往返延迟
  await sleep(300);
  const xAfter = (await dbg(page)).players.P1;
  check('松开立即停止（无惯性）', Math.abs(xAfter - xReleased) < 0.5, `xReleased=${xReleased.toFixed(2)}, xAfter=${xAfter.toFixed(2)}`);

  // 3. 点击瞄准按钮 → AIMING；再次点击 = 取消
  //    Phase 9 反馈 ②：AimButton = 右侧垂直居中准星 icon（844×390 → (792,195)）
  await page.touchscreen.touchStart(792, 195);
  await page.touchscreen.touchEnd();
  await waitFor(page, async () => (await dbg(page)).cameraMode === 'AIMING', 1500, 'AIMING');
  check('点击 AimButton → RETURN_HOME → AIMING', true);
  check(
    'Phase 9：AIMING 中 ◀/▶ 移动按钮隐藏（点击瞄准即位置锁定）',
    (await dbg(page)).moveButtonsVisible === false
  );

  await page.touchscreen.touchStart(792, 195);
  await page.touchscreen.touchEnd();
  await waitFor(page, async () => (await dbg(page)).cameraMode === 'FREE_VIEW', 1000, 'FREE_VIEW');
  check('AIMING 时点击按钮 = 取消瞄准（触屏无 Esc）', true);
  check(
    '取消瞄准后 ◀/▶ 移动按钮恢复显示',
    (await dbg(page)).moveButtonsVisible === true
  );

  // 3.5 真机错位回归：画布被浏览器偏移后，点击"视觉位置"仍命中 zone
  //     （InputRouter 把 client 坐标换算到画布空间，输入与画面永远同空间；
  //     负向偏移：按钮移到视口左侧仍有完整画布覆盖，正向会把 icon 推出 844 视口）
  await page.evaluate(() => {
    const c = document.querySelector('canvas');
    c.style.position = 'fixed';
    c.style.left = '-100px';
    c.style.top = '-50px';
  });
  await sleep(300);
  await page.touchscreen.touchStart(692, 145); // 游戏坐标 (792,195) 的视觉偏移位置
  await page.touchscreen.touchEnd();
  const offsetAiming = await waitFor(
    page,
    async () => (await dbg(page)).cameraMode === 'AIMING',
    1500,
    '偏移画布下仍可点击'
  );
  check('画布被偏移时点击视觉位置仍命中（坐标归一化）', offsetAiming === true);
  await page.evaluate(() => {
    const c = document.querySelector('canvas');
    c.style.position = '';
    c.style.left = '';
    c.style.top = '';
  });
  await sleep(300);
  await page.touchscreen.touchStart(792, 195); // 复原后取消瞄准
  await page.touchscreen.touchEnd();
  await waitFor(page, async () => (await dbg(page)).cameraMode === 'FREE_VIEW', 1000, 'FREE_VIEW');

  // 4. 触摸瞄准拖拽（放大起始区 + 死区）→ 发射
  await page.touchscreen.touchStart(792, 195);
  await page.touchscreen.touchEnd();
  await waitFor(page, async () => (await dbg(page)).cameraMode === 'AIMING', 1500, 'AIMING');

  const origin = await launchOriginScreen(page, 844, 390);
  // 起点在炮塔上方 60px：避开底部按钮行，仍在 150px 触摸起始半径内
  const startY = origin.y - 60;
  await page.touchscreen.touchStart(origin.x, startY);
  // 先在死区内小挪（不应激活）
  await page.touchscreen.touchMove(origin.x + 5, startY + 5);
  const pendingAim = await page.evaluate(() => window.__RR_DEBUG__.hasFired);
  // 超过死区（14px）激活并拖出力度：45° 弹道求解，直接命中 P2
  const shot = solveFortyFiveRelease(origin, await dbg(page), 4550);
  await page.touchscreen.touchMove(shot.x, shot.y);
  await page.touchscreen.touchEnd();
  check('死区内拖动不发射', pendingAim === false);

  const fired = await waitFor(
    page,
    async () => (await dbg(page)).hasFired,
    3000,
    'hasFired'
  );
  check('触摸拖拽（>死区）释放 → FireCommand', fired);
  const flight = await dbg(page);
  check('发射后相机 PROJECTILE_FOLLOW（与桌面同链路）', flight.cameraMode === 'PROJECTILE_FOLLOW');

  const resolved = await waitFor(
    page,
    async () => (await dbg(page)).cameraMode === 'FREE_VIEW',
    12000,
    '攻击结束'
  );
  check('攻击结束回 FREE_VIEW', resolved === true);

  // Phase 7：触屏命中结算（与桌面同一条 DamageSystem 链路）
  const endState = await dbg(page);
  check(
    '触摸命中结算：P2 HP 下降（与桌面同一伤害链路）',
    endState.hp.P2 < 10,
    `P2 hp=${endState.hp.P2}`
  );
  check('P1 未受伤', endState.hp.P1 === 10, `P1 hp=${endState.hp.P1}`);
  check('游戏未结束', endState.gameOver === false);

  // Phase 8：回合切换（相机已 TURN_TRANSITION 到 P2）
  const turn2 = await dbg(page);
  check(
    '回合切换：turnId 2、当前玩家 P2、phase ACTION',
    turn2.turnId === 2 &&
      turn2.currentPlayerId === 'P2' &&
      turn2.phase === 'ACTION',
    `turn=${turn2.turnId} player=${turn2.currentPlayerId} phase=${turn2.phase}`
  );

  // Phase 9：回合切换横幅（相机到位后 P2 回合开始时展示）
  const mBanner2 = await waitFor(
    page,
    async () =>
      (await dbg(page)).lastBannerText === 'P2 · 第 2 回合' ? true : null,
    3000,
    'P2 回合横幅'
  );
  check('回合切换横幅：P2 · 第 2 回合', mBanner2 === true);

  // 5. 快捷聚焦按钮（FREE_VIEW 激活）：当前玩家为 P2、相机已在其阵地，
  //    先点「敌方」平移到 P1，再点「己方」回来，双向验证 panToX
  const beforeFocus = (await dbg(page)).cameraScrollX;
  await page.touchscreen.touchStart(438, 358); // 「敌方」（底部居中，Phase 9 反馈 ②）
  await page.touchscreen.touchEnd();
  await sleep(900);
  const afterEnemy = (await dbg(page)).cameraScrollX;
  check(
    '点击「敌方」→ 相机平移到对方阵地',
    Math.abs(afterEnemy - beforeFocus) > 1000,
    `scroll ${beforeFocus.toFixed(0)} → ${afterEnemy.toFixed(0)}`
  );

  await page.touchscreen.touchStart(406, 358); // 「己方」
  await page.touchscreen.touchEnd();
  await sleep(900);
  const afterSelf = (await dbg(page)).cameraScrollX;
  check(
    '点击「己方」→ 相机平移回己方阵地',
    Math.abs(afterSelf - afterEnemy) > 1000,
    `scroll ${afterEnemy.toFixed(0)} → ${afterSelf.toFixed(0)}`
  );

  // 6. 竖屏门禁：显示旋转提示 + 手势被覆盖层拦截
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await sleep(400);
  const overlayShown = await page.evaluate(() =>
    document.getElementById('rotate-overlay').classList.contains('is-visible')
  );
  check('竖屏显示「请横过来」覆盖层', overlayShown);

  const scrollBeforeBlock = (await dbg(page)).cameraScrollX;
  const client = await page.createCDPSession();
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 195, y: 400 }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 95, y: 400 }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(150);
  const scrollAfterBlock = (await dbg(page)).cameraScrollX;
  check(
    '竖屏覆盖层拦截游戏手势（相机不动）',
    Math.abs(scrollAfterBlock - scrollBeforeBlock) < 1,
    `Δ=${(scrollAfterBlock - scrollBeforeBlock).toFixed(2)}`
  );

  // 7. 转回横屏：覆盖层消失
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(400);
  const overlayGone = await page.evaluate(() =>
    !document.getElementById('rotate-overlay').classList.contains('is-visible')
  );
  check('转回横屏覆盖层消失（resize/orientation 处理）', overlayGone);

  await page.close();

  // ---- Phase 18 Step 16：视口矩阵扩展（932×430 @DPR3）+ pointer 回归 -------
  section('Mobile — Viewport Matrix 932×430 @DPR3 + pointercancel + 双指移动（Phase 18）');

  const vp = await browser.newPage();
  await vp.setViewport({
    width: 932, height: 430, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  await vp.goto(URL, { waitUntil: 'load' });
  await waitForScene(vp, 'MainMenuScene', 15000);
  await tapMenuButton(vp, 'local2p');
  await waitForScene(vp, 'BattleScene', 10000);

  // DPR3 视口断言组（设备矩阵 932×430：iPhone 16 Pro Max 档）
  const v0 = await dbg(vp);
  check('932×430@3：控制档位 touch', v0.controlProfile === 'touch');
  check(
    '932×430@3：uiScale = DPR 3（游戏坐标 = 物理像素）',
    v0.uiScale === 3,
    `uiScale=${v0.uiScale}`
  );
  const bmp = await vp.evaluate(() => ({
    w: document.querySelector('canvas').width,
    h: document.querySelector('canvas').height,
  }));
  check(
    '932×430@3：画布位图 = 2796×1290（CSS×DPR，不回退 CSS 位图）',
    bmp.w === 932 * 3 && bmp.h === 430 * 3,
    `bmp=${bmp.w}x${bmp.h}`
  );
  const cssVP = await vp.evaluate(() => ({
    w: document.querySelector('canvas').clientWidth,
    h: document.querySelector('canvas').clientHeight,
  }));
  check(
    '932×430@3：画布 CSS 尺寸 = 视口',
    cssVP.w === 932 && cssVP.h === 430,
    `css=${cssVP.w}x${cssVP.h}`
  );
  check(
    '932×430@3：zoom = (430×3)/1080 ≈ 1.194（纵向构图恒定）',
    Math.abs(v0.cameraZoom - (430 * 3) / 1080) < 0.005,
    `zoom=${v0.cameraZoom}`
  );
  check(
    '932×430@3：landscape + 旋转覆盖层隐藏',
    v0.orientation === 'landscape' &&
      (await vp.evaluate(
        () => !document.getElementById('rotate-overlay').classList.contains('is-visible')
      ))
  );

  // Phase 18 粒子预算基线：开局（HP 10）无发射器活跃
  check(
    '粒子预算基线：开局存活粒子 = 0',
    (await dbg(vp)).particles === 0,
    `particles=${(await dbg(vp)).particles}`
  );

  // 双指各按 ◀/▶（synthetic PointerEvent 多指：CDP 单点 API 无法真双指；
  // client 坐标经 InputRouter 归一化到画布空间，与真实触摸同链路）
  const m0 = (await dbg(vp)).players.P1;
  const twoFingerButtons = (await dbg(vp)).moveButtons;
  await vp.evaluate(({ left, right }) => {
    const c = document.querySelector('canvas');
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 41, pointerType: 'touch', clientX: left.x, clientY: left.y, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 42, pointerType: 'touch', clientX: right.x, clientY: right.y, bubbles: true }));
  }, twoFingerButtons);
  await sleep(500);
  const m1 = (await dbg(vp)).players.P1;
  check(
    '双指各按 ◀/▶：净方向 0（原地不动）',
    Math.abs(m1 - m0) < 2,
    `x: ${m0.toFixed(0)} → ${m1.toFixed(0)}`
  );
  await vp.evaluate(() => {
    const c = document.querySelector('canvas');
    c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 41, pointerType: 'touch', bubbles: true }));
  });
  await sleep(500);
  const m2 = (await dbg(vp)).players.P1;
  check(
    '松开 ◀（剩 ▶）：向右移动（多指独立追踪）',
    m2 > m1 + 40,
    `x: ${m1.toFixed(0)} → ${m2.toFixed(0)}`
  );
  await vp.evaluate(() => {
    const c = document.querySelector('canvas');
    c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 42, pointerType: 'touch', bubbles: true }));
  });
  await sleep(300);
  const m3 = (await dbg(vp)).players.P1;
  await sleep(300);
  const m4 = (await dbg(vp)).players.P1;
  check(
    '双指全松开：立即停止（无惯性 / 无卡键）',
    Math.abs(m4 - m3) < 0.5,
    `xReleased=${m3.toFixed(2)}, xAfter=${m4.toFixed(2)}`
  );

  // pointercancel：相机拖拽被系统打断（来电 / 手势接管）→ 释放无残留
  const synthDrag = async (type, id, x, y) => {
    await vp.evaluate(
      (t, pid, cx, cy) => {
        const c = document.querySelector('canvas');
        c.dispatchEvent(new PointerEvent(t, { pointerId: pid, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true }));
      },
      type, id, x, y
    );
  };
  const cPre = (await dbg(vp)).cameraScrollX;
  await synthDrag('pointerdown', 7, 600, 200);
  await synthDrag('pointermove', 7, 500, 200);
  await synthDrag('pointercancel', 7, 500, 200);
  await sleep(150);
  const cMid = (await dbg(vp)).cameraScrollX;
  // 前置：首个合成拖拽确实平移了相机（证明合成链路有效，cancel 用例非空洞）
  check(
    '合成拖拽生效：pointerdown→move 平移相机（与真实触摸同链路）',
    Math.abs(cMid - cPre) > 30,
    `scroll: ${cPre.toFixed(0)} → ${cMid.toFixed(0)}`
  );
  // cancel 后新手势仍可自由拖动（无残留 gesture owner）
  await vp.touchscreen.touchStart(600, 200);
  await vp.touchscreen.touchMove(540, 200);
  await vp.touchscreen.touchEnd();
  await sleep(150);
  const cAfter = (await dbg(vp)).cameraScrollX;
  check(
    'pointercancel 释放拖拽：后续手势仍可平移相机（无残留 owner）',
    Math.abs(cAfter - cMid) > 30,
    `scroll: ${cMid.toFixed(0)} → ${cAfter.toFixed(0)}`
  );

  // 932×430 完整链路：AimButton（W−52, H/2）→ 瞄准 → 发射 → 跟随 → 换手
  await vp.touchscreen.touchStart(880, 215);
  await vp.touchscreen.touchEnd();
  await waitFor(vp, async () => (await dbg(vp)).cameraMode === 'AIMING', 1500, 'AIMING');
  const origin932 = await launchOriginScreen(vp, 932, 430);
  const startY932 = origin932.y - 60;
  await vp.touchscreen.touchStart(origin932.x, startY932);
  await vp.touchscreen.touchMove(origin932.x + 5, startY932 + 5); // 死区内不激活
  const shot932 = solveFortyFiveRelease(origin932, await dbg(vp), 4550);
  await vp.touchscreen.touchMove(shot932.x, shot932.y);
  await vp.touchscreen.touchEnd();
  const fired932 = await waitFor(
    vp,
    async () => (await dbg(vp)).hasFired,
    3000,
    'hasFired'
  );
  check('932×430：触摸拖拽（>死区）释放 → 发射', fired932 === true);
  check(
    '932×430：发射后相机 PROJECTILE_FOLLOW（与 844×390 同链路）',
    (await dbg(vp)).cameraMode === 'PROJECTILE_FOLLOW'
  );
  // 粒子计数器 sanity：飞行期弹尾火焰/烟雾发射器活跃 → 存活粒子 > 0
  //（与开局基线 ===0 成对：证明计数器在工作，而非恒 0）
  const inFlightParticles = await waitFor(
    vp,
    async () => ((await dbg(vp)).particles > 0 ? true : null),
    3000,
    '飞行期存活粒子 > 0'
  );
  check('粒子预算：飞行期存活粒子 > 0（计数器 sanity）', inFlightParticles === true);
  const resolved932 = await waitFor(
    vp,
    async () => (await dbg(vp)).cameraMode === 'FREE_VIEW',
    12000,
    '攻击结束'
  );
  check('932×430：攻击结束回 FREE_VIEW', resolved932 === true);
  const turn932 = await dbg(vp);
  check(
    '932×430：回合切换 P2 · 第 2 回合（触屏全链路跨视口稳定）',
    turn932.turnId === 2 && turn932.currentPlayerId === 'P2',
    `turn=${turn932.turnId} player=${turn932.currentPlayerId}`
  );

  await vp.close();
}

// ---- Single Player 场景（Phase 10 冒烟 + Phase 11 Result/Rematch） -------

async function runSinglePlayer(browser) {
  section('Single Player — AI（菜单进入 → 对战 → Result → Rematch/Menu）');

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'load' });

  // Phase 11：菜单 → SINGLE PLAYER → BattleScene
  await waitForScene(page, 'MainMenuScene', 15000);
  await clickMenuButton(page, 'singlePlayer');
  await waitForScene(page, 'BattleScene', 10000);
  const d0 = await dbg(page);
  check('SP 模式激活（菜单进入，aiEnabled）', d0.aiEnabled === true);
  check('开局为 P1 人类回合', d0.currentPlayerId === 'P1' && d0.phase === 'ACTION');

  // 1. 人类回合输入可用（P1 移动）
  const xBefore = d0.players.P1;
  await page.keyboard.down('d');
  await sleep(400);
  await page.keyboard.up('d');
  const xAfter = (await dbg(page)).players.P1;
  check('人类回合：键盘控制 P1 移动正常', xAfter - xBefore > 80, `Δx=${(xAfter - xBefore).toFixed(1)}`);

  // 2. 人类开火（45° 求解）→ 回合切到 AI
  await fireFortyFiveShot(page, 1280, 800, 4550);
  await waitFor(
    page,
    async () => (await dbg(page)).cameraMode === 'FREE_VIEW',
    12000,
    '人类攻击结束'
  );
  const turn2 = await dbg(page);
  check(
    '回合切换到 P2（AI）',
    turn2.turnId === 2 && turn2.currentPlayerId === 'P2' && turn2.phase === 'ACTION',
    `turn=${turn2.turnId} player=${turn2.currentPlayerId}`
  );

  // 3. AI 回合：人类瞄准热键静默（Space 不得驱动 AI 的瞄准相机流程；
  //    AI 自身的 PROJECTILE_FOLLOW 属合法状态，不在此断言范围）
  await page.keyboard.press('Space');
  await sleep(300);
  const afterSpace = await dbg(page);
  check(
    'AI 回合人类热键静默（Space 未触发 RETURN_HOME/AIMING）',
    afterSpace.cameraMode !== 'RETURN_HOME' && afterSpace.cameraMode !== 'AIMING',
    `mode=${afterSpace.cameraMode}`
  );

  // 4. AI 自动完成回合：思考 →（可能 MOVE）→ FIRE → 结算 → 切回人类
  const backToHuman = await waitFor(
    page,
    async () => {
      const s = await dbg(page);
      return s.currentPlayerId === 'P1' && s.turnId === 3 && s.phase === 'ACTION'
        ? s
        : null;
    },
    20000,
    'AI 完成回合并切回人类'
  );
  check(
    'AI 自动开火并切回人类（turn 3 = P1）',
    backToHuman !== null && backToHuman.gameOver === false,
    `turn=${backToHuman?.turnId} player=${backToHuman?.currentPlayerId}`
  );
  check(
    'AI 未对人类造成致命伤（游戏未结束）',
    backToHuman.hp.P1 > 0,
    `P1 hp=${backToHuman.hp.P1}`
  );

  // 5. 人类输入恢复（回合归属切回）
  const p1Before = (await dbg(page)).players.P1;
  await page.keyboard.down('a');
  await sleep(400);
  await page.keyboard.up('a');
  const p1Moved = (await dbg(page)).players.P1;
  check(
    '切回人类后输入恢复（A/D 可用）',
    Math.abs(p1Moved - p1Before) > 60,
    `Δx=${(p1Moved - p1Before).toFixed(1)}`
  );

  // 6. Phase 11：击杀（注入残血）→ ResultScene（YOU WIN）
  await page.evaluate(() => window.__RR_DEBUG__.setHp('P2', 2));
  const targetP2 = (await dbg(page)).players.P2;
  await fireFortyFiveShot(page, 1280, 800, targetP2);
  await waitForScene(page, 'ResultScene', 15000);
  const result1 = await dbg(page);
  check(
    'ResultScene：YOU WIN（Single Player 文案）',
    result1.resultText === 'YOU WIN',
    `text="${result1.resultText}"`
  );

  // 7. REMATCH：以同一 MatchSetup 重建全新对局（旧局污染全清）
  await clickMenuButton(page, 'rematch');
  await waitForScene(page, 'BattleScene', 10000);
  const fresh = await dbg(page);
  check(
    'Rematch：全新对局（HP 10/10、turn 1、P1 回合、AI 保持）',
    fresh.hp.P1 === 10 &&
      fresh.hp.P2 === 10 &&
      fresh.turnId === 1 &&
      fresh.currentPlayerId === 'P1' &&
      fresh.aiEnabled === true,
    `hp=${fresh.hp.P1}/${fresh.hp.P2} turn=${fresh.turnId} player=${fresh.currentPlayerId}`
  );

  // 8. 再杀一局 → MAIN MENU 返回
  await page.evaluate(() => window.__RR_DEBUG__.setHp('P2', 2));
  const targetP2b = (await dbg(page)).players.P2;
  await fireFortyFiveShot(page, 1280, 800, targetP2b);
  await waitForScene(page, 'ResultScene', 15000);
  const result2 = await dbg(page);
  check(
    '第二局 ResultScene：YOU WIN',
    result2.resultText === 'YOU WIN',
    `text="${result2.resultText}"`
  );
  await clickMenuButton(page, 'mainMenu');
  await waitForScene(page, 'MainMenuScene', 5000);
  check('Result → MAIN MENU 返回主菜单（SP）', true);

  // 9. Phase 11 C1 回归：同会话跨模式切换 —— SP 完赛后进入 LOCAL 2P，
  //    幽灵 AI 不得残留（aiEnabled=false、P2 回合人类热座可控、无自动开火）
  await clickMenuButton(page, 'local2p');
  await waitForScene(page, 'BattleScene', 10000);
  const l2p = await dbg(page);
  check(
    '跨模式：LOCAL 2P 无残留 AI（aiEnabled=false）',
    l2p.aiEnabled === false,
    `aiEnabled=${l2p.aiEnabled}`
  );

  // P1 人类开火 → 回合切到 P2（此时人类热座应控制 P2）
  await fireFortyFiveShot(page, 1280, 800, 4550);
  await waitFor(
    page,
    async () => {
      const s = await dbg(page);
      return s.currentPlayerId === 'P2' && s.turnId === 2 && s.phase === 'ACTION'
        ? s
        : null;
    },
    15000,
    'P2 人类回合开始'
  );
  const p2Turn = await dbg(page);
  check('跨模式：回合切到 P2（Local 2P 热座）', p2Turn.currentPlayerId === 'P2');

  const p2Before = p2Turn.players.P2;
  await page.keyboard.down('d');
  await sleep(400);
  await page.keyboard.up('d');
  const p2After = (await dbg(page)).players.P2;
  check(
    '跨模式：P2 回合人类键盘可控（热座未被禁用）',
    p2After - p2Before > 80,
    `Δx=${(p2After - p2Before).toFixed(1)}`
  );

  // 幽灵 AI 若残留会在 think(500~900ms)+停顿内自动开火
  await sleep(1500);
  const noGhost = await dbg(page);
  check(
    '跨模式：幽灵 AI 未接管（P2 未自动开火）',
    noGhost.hasFired === false && noGhost.phase === 'ACTION',
    `hasFired=${noGhost.hasFired} phase=${noGhost.phase}`
  );

  await page.close();
}

// ---- Online P2P 场景（Phase 13：双页真实 WebRTC 手动配对 smoke） ----------

/**
 * 两个独立 page（同一 headless Chrome 的两个标签页，真实 RTCPeerConnection /
 * RTCDataChannel / 本机 host candidates 直连）执行完整手动配对：
 * Host CREATE GAME → 复制 Offer Code → Guest JOIN + 粘贴 → CREATE RESPONSE
 * → 复制 Answer → Host 粘贴 → CONNECT → 双方 VERIFIED（PING/PONG RTT）。
 */
async function runOnlineP2P(browser) {
  section('Online P2P — Manual Pairing（真实 WebRTC 双页 smoke）');

  // 串行初始化两页（避免双 newPage 并存时序）：Host 先完整进入连接场景
  const pageHost = await browser.newPage();
  pageHost.on('pageerror', (e) => console.log('[HOST PAGEERROR]', e.message));
  pageHost.on('console', (m) => console.log(`[HOST console.${m.type()}]`, m.text().slice(0, 200)));
  await pageHost.setViewport({ width: 1280, height: 800 });
  await pageHost.goto(`${URL}?manual-sdp`, { waitUntil: 'load' });
  await this?.noop; // (占位防误删)
  try {
    await waitForScene(pageHost, 'MainMenuScene', 15000);
  } catch (error) {
    const dump = await pageHost
      .evaluate(() => ({
        url: location.href,
        readyState: document.readyState,
        title: document.title,
        scripts: [...document.scripts].map((s) => s.src),
        hasCanvas: !!document.querySelector('canvas'),
        phaserBooted: typeof window.Phaser,
      }))
      .catch((e) => String(e));
    console.log('[P2P DIAG]', JSON.stringify(dump));
    throw error;
  }
  await clickMenuButton(pageHost, 'online');
  await waitForScene(pageHost, 'OnlineConnectionScene', 5000);

  const pageGuest = await browser.newPage();
  pageGuest.on('pageerror', (e) => console.log('[GUEST PAGEERROR]', e.message));
  pageGuest.on('console', (m) => console.log(`[GUEST console.${m.type()}]`, m.text().slice(0, 200)));
  await pageGuest.setViewport({ width: 1280, height: 800 });
  await pageGuest.goto(`${URL}?manual-sdp`, { waitUntil: 'load' });
  await waitForScene(pageGuest, 'MainMenuScene', 15000);
  await clickMenuButton(pageGuest, 'online');
  await waitForScene(pageGuest, 'OnlineConnectionScene', 5000);

  // Host：CREATE GAME → Offer Code
  await clickMenuButton(pageHost, 'create');
  const hostCode = await waitFor(
    pageHost,
    async () => (await dbg(pageHost)).connectionCode,
    15000,
    'Host Offer Code'
  );
  check(
    'Host 生成 Offer Code（RR1-OFFER- 前缀，含完整 ICE SDP）',
    typeof hostCode === 'string' && hostCode.startsWith('RR1-OFFER-'),
    `${String(hostCode).slice(0, 24)}…`
  );

  // Guest：JOIN GAME → 粘贴 Offer → CREATE RESPONSE
  await clickMenuButton(pageGuest, 'join');
  await waitFor(
    pageGuest,
    async () => (await dbg(pageGuest)).state === 'GUEST_WAITING_FOR_OFFER',
    5000,
    'Guest 等待输入'
  );
  await pageGuest.evaluate((code) => window.__RR_DEBUG__.setInputText(code), hostCode);
  await clickMenuButton(pageGuest, 'createResponse');
  const responseCode = await waitFor(
    pageGuest,
    async () => (await dbg(pageGuest)).connectionCode,
    15000,
    'Guest Response Code'
  );
  check(
    'Guest 生成 Response Code（RR1-ANSWER-）',
    typeof responseCode === 'string' && responseCode.startsWith('RR1-ANSWER-'),
    `${String(responseCode).slice(0, 24)}…`
  );

  // Host：粘贴 Response → CONNECT
  await pageHost.evaluate((code) => window.__RR_DEBUG__.setInputText(code), responseCode);
  await clickMenuButton(pageHost, 'connect');

  // 双方 VERIFIED（真实 DataChannel + PING/PONG）
  const verifiedHost = await waitFor(
    pageHost,
    async () => (await dbg(pageHost)).state === 'VERIFIED',
    30000,
    'Host VERIFIED'
  );
  const verifiedGuest = await waitFor(
    pageGuest,
    async () => (await dbg(pageGuest)).state === 'VERIFIED',
    30000,
    'Guest VERIFIED'
  );
  check('双方 VERIFIED（真实 WebRTC DataChannel 建立成功）', verifiedHost && verifiedGuest);

  await sleep(2500); // 等一轮持续 PING → RTT 刷新
  const hostState = await dbg(pageHost);
  const guestState = await dbg(pageGuest);
  // Host RTT 轮询(10s 窗口内 interval ping 必达;仍无值则 dump 诊断)
  const hostRtt = await waitFor(
    pageHost,
    async () => {
      const d = await dbg(pageHost);
      return typeof d.lastRttMs === 'number' ? d.lastRttMs : null;
    },
    10_000,
    'Host RTT'
  ).catch(async () => {
    const d = await dbg(pageHost);
    console.log('[RTT DIAG]', JSON.stringify({ state: d.state, rtt: d.lastRttMs, sessionStored: d.sessionStored }));
    return null;
  });
  check(
    'Host 显示 RTT（PING/PONG 真实通过 DataChannel）',
    hostRtt !== null,
    `rtt=${hostRtt}ms sessionStored=${hostState.sessionStored}`
  );
  check(
    'Guest 显示 RTT',
    typeof guestState.lastRttMs === 'number' && guestState.lastRttMs >= 0,
    `rtt=${guestState.lastRttMs}ms`
  );

  // 收尾：双方回菜单（backToMenu），连接彻底释放。
  // headless 后台 page 的 rAF 冻结（visibilityState=hidden，实测 flags 无效）
  // 会卡住 fade/scene.start —— 收尾前 bringToFront 轮转前台
  console.log('[P2P] before back:', JSON.stringify({ host: (await dbg(pageHost)).state, guest: (await dbg(pageGuest)).state }));
  await pageHost.bringToFront();
  await clickMenuButton(pageHost, 'backToMenu');
  try {
    await waitForScene(pageHost, 'MainMenuScene', 5000);
    console.log('[P2P] host back OK');
  } catch (e) {
    const d = await dbg(pageHost);
    console.log('[P2P] host back FAIL:', e.message, 'state=', d.state, 'scenes=', JSON.stringify(d.phaserSceneStates));
    throw e;
  }
  await pageGuest.bringToFront();
  await clickMenuButton(pageGuest, 'backToMenu');
  try {
    await waitForScene(pageGuest, 'MainMenuScene', 5000);
    console.log('[P2P] guest back OK');
  } catch (e) {
    console.log('[P2P] guest back FAIL:', e.message, 'state=', (await dbg(pageGuest)).state);
    throw e;
  }
  check('双方 BACK TO MENU 返回（连接彻底释放，无残留）', true);

  await pageHost.close();
  await pageGuest.close();
}

// ---- Online Battle 场景（Phase 14：双页真实 WebRTC 完整对战 smoke） ------

/**
 * Phase 14 E2E：真实 RTCPeerConnection 配对后完成 P1 → P2 → P1 完整回合循环。
 * 关键机制（Phase 13 实测）：headless 后台页 rAF 冻结（flags 无效），但
 * DataChannel 消息经事件循环照常投递、evaluate 照常可读 —— 谁的本地模拟
 * 需要推进（炮弹飞行 / 爆炸 / 转场 tween），谁就必须处于前台；后台页只做
 * 消息接收与状态写入。因此按"前台舞蹈"推进：Host 回合 host 前台 →
 * Guest 回合 guest 前台（FIRE_REQUEST 经事件循环在 Host 后台完成校验广播）→
 * Host 前台结算（TURN_RESULT + TURN_END）→ Guest 前台完成应用。
 * 断言全部以"双端一致性（Host 权威）"为准，不依赖具体命中数值。
 */
async function runOnlineBattle(browser) {
  section('Online Battle — P2P Gameplay Sync（真实 WebRTC 双页对战）');

  // —— 手动配对（与 Phase 13 相同流程）——
  const pageHost = await browser.newPage();
  pageHost.on('pageerror', (e) => console.log('[HOST PAGEERROR]', e.message));
  pageHost.on('console', (m) => console.log(`[HOST console.${m.type()}]`, m.text().slice(0, 200)));
  await pageHost.setViewport({ width: 1280, height: 800 });
  await pageHost.goto(`${URL}?manual-sdp`, { waitUntil: 'load' });
  await waitForScene(pageHost, 'MainMenuScene', 15000);
  await clickMenuButton(pageHost, 'online');
  await waitForScene(pageHost, 'OnlineConnectionScene', 5000);

  const pageGuest = await browser.newPage();
  pageGuest.on('pageerror', (e) => console.log('[GUEST PAGEERROR]', e.message));
  pageGuest.on('console', (m) => console.log(`[GUEST console.${m.type()}]`, m.text().slice(0, 200)));
  await pageGuest.setViewport({ width: 1280, height: 800 });
  await pageGuest.goto(`${URL}?manual-sdp`, { waitUntil: 'load' });
  await waitForScene(pageGuest, 'MainMenuScene', 15000);
  await clickMenuButton(pageGuest, 'online');
  await waitForScene(pageGuest, 'OnlineConnectionScene', 5000);

  await clickMenuButton(pageHost, 'create');
  const hostCode = await waitFor(
    pageHost,
    async () => (await dbg(pageHost)).connectionCode,
    15000,
    'Host Offer Code'
  );
  await clickMenuButton(pageGuest, 'join');
  await waitFor(
    pageGuest,
    async () => (await dbg(pageGuest)).state === 'GUEST_WAITING_FOR_OFFER',
    5000,
    'Guest 等待输入'
  );
  await pageGuest.evaluate((code) => window.__RR_DEBUG__.setInputText(code), hostCode);
  await clickMenuButton(pageGuest, 'createResponse');
  const responseCode = await waitFor(
    pageGuest,
    async () => (await dbg(pageGuest)).connectionCode,
    15000,
    'Guest Response Code'
  );
  await pageHost.evaluate((code) => window.__RR_DEBUG__.setInputText(code), responseCode);
  await clickMenuButton(pageHost, 'connect');
  await waitFor(pageHost, async () => (await dbg(pageHost)).state === 'VERIFIED', 30000, 'Host VERIFIED');
  await waitFor(pageGuest, async () => (await dbg(pageGuest)).state === 'VERIFIED', 30000, 'Guest VERIFIED');
  check('双页配对 VERIFIED（真实 WebRTC DataChannel）', true);

  await driveOnlineBattle(pageHost, pageGuest);
}

/**
 * Phase 14/16 对战驱动（配对后通用，Manual / Room 两段复用）：
 * ENTER BATTLE → 回合循环 → Rematch → Disconnect。
 */
async function driveOnlineBattle(pageHost, pageGuest, hooks = {}) {
  const hostD = () => dbg(pageHost);
  const guestD = () => dbg(pageGuest);

  // —— ENTER BATTLE：各自前台点击（PLAYER_READY 经事件循环对端即时可收）——
  await pageGuest.bringToFront();
  await clickMenuButton(pageGuest, 'enterBattle');
  await waitFor(
    pageGuest,
    async () => (await dbg(pageGuest)).lobbyPhase === 'waiting',
    5000,
    'Guest PLAYER_READY'
  );
  await pageHost.bringToFront();
  await clickMenuButton(pageHost, 'enterBattle');
  // Host 汇齐双方 Ready → GAME_START → 双方转场（转场需 rAF —— 各自前台化）
  await waitForScene(pageHost, 'BattleScene', 15000);
  await pageGuest.bringToFront();
  await waitForScene(pageGuest, 'BattleScene', 15000);

  const h0 = await hostD();
  const g0 = await guestD();
  check(
    'Host=P1 / Guest=P2 角色正确',
    h0.onlineRole === 'host' && h0.localPlayerId === 'P1' && g0.onlineRole === 'guest' && g0.localPlayerId === 'P2'
  );
  check(
    'GAME_START 双端同源（HP / 回合 / 位置一致）',
    h0.hp.P1 === g0.hp.P1 && h0.hp.P2 === g0.hp.P2 && h0.turnId === g0.turnId && h0.players.P1 === g0.players.P1 && h0.players.P2 === g0.players.P2
  );

  // —— P1 Turn 1（Host 回合；host 前台推进）——
  await pageHost.bringToFront();
  await pageHost.keyboard.down('d');
  await sleep(350);
  await pageHost.keyboard.up('d');
  const hostMoved = await waitFor(
    pageHost,
    async () => (await hostD()).players.P1 > 460,
    5000,
    'Host P1 移动生效'
  );
  const guestSyncMove = await waitFor(
    pageGuest,
    async () => (await guestD()).players.P1 > 460,
    5000,
    'Guest 同步 Host 移动（后台事件循环应用）'
  ).catch(async (error) => {
    const gh = await hostD();
    const gg = await guestD();
    console.log(
      '[MOVE DIAG]',
      JSON.stringify({
        hostPlayers: gh.players,
        guestPlayers: gg.players,
        guestLastRx: gg.online?.lastRxType,
        guestNetState: gg.online?.netState,
        guestMatchId: gg.online?.matchId,
        guestTurn: gg.turnId,
        guestCurrent: gg.currentPlayerId,
        guestPhase: gg.phase,
      })
    );
    throw error;
  });
  check('Host Move 双方可见（权威 MOVE 广播）', hostMoved && guestSyncMove);

  // Host 发炮：45° 求解瞄向 P2
  if (hooks.beforeFirstFire) await hooks.beforeFirstFire(pageHost, pageGuest);
  const hostP2x = (await hostD()).players.P2;
  await fireFortyFiveShot(pageHost, 1280, 800, hostP2x);
  // Guest（后台）收到 FIRE 广播并本地发射 —— DataChannel 事件循环，无需前台
  const guestFired = await waitFor(
    pageGuest,
    async () => (await guestD()).hasFired === true,
    5000,
    'Guest 收到 FIRE 广播'
  );
  check('Host Fire 双方发射（广播 → 双端本地模拟）', guestFired);

  // Host 前台：炮弹飞行 → 爆炸 → TURN_RESULT → dwell → TURN_END → P2 回合
  const hostToP2 = await waitFor(
    pageHost,
    async () => {
      const d = await hostD();
      return d.currentPlayerId === 'P2' && d.phase === 'ACTION' && d.turnId === 2;
    },
    25000,
    'Host 进入 P2 回合'
  );
  check('Host 回合切换 P1→P2（Host 权威 TURN_END）', hostToP2);

  // Guest 前台恢复 rAF：本地炮弹落地结算 → dwell → pending TURN_END → P2 回合
  await pageGuest.bringToFront();
  const guestToP2 = await waitFor(
    pageGuest,
    async () => {
      const d = await guestD();
      return d.currentPlayerId === 'P2' && d.phase === 'ACTION' && d.turnId === 2;
    },
    25000,
    'Guest 进入 P2 回合'
  );
  check('Guest 经 Turn Barrier 进入 P2 回合（不超前 Host）', guestToP2);

  const hAfterT1 = await hostD();
  const gAfterT1 = await guestD();
  check(
    'Turn 1 权威结算后双端 HP 一致',
    JSON.stringify(hAfterT1.hp) === JSON.stringify(gAfterT1.hp)
  );

  // —— SG-8（可选注入）：Turn 2 前做 ICE restart 恢复场景（Room 段专用）——
  if (hooks.onMidBattle) {
    await hooks.onMidBattle(pageHost, pageGuest);
  }

  // —— P2 Turn 2（Guest 回合；guest 前台）——
  await pageGuest.keyboard.down('a');
  await sleep(350);
  await pageGuest.keyboard.up('a');
  const guestMoved = await waitFor(
    pageGuest,
    async () => (await guestD()).players.P2 < 4500,
    5000,
    'Guest P2 移动生效'
  );
  const hostSyncMove2 = await waitFor(
    pageHost,
    async () => (await hostD()).players.P2 < 4500,
    5000,
    'Host 同步 Guest 移动（后台校验 + 广播）'
  );
  check('Guest Move 经 Host 验证后双方可见（MOVE_REQUEST → 权威 MOVE）', guestMoved && hostSyncMove2);

  const hostP1x = (await hostD()).players.P1;
  try {
    await fireFortyFiveShot(pageGuest, 1280, 800, hostP1x);
  } catch (error) {
    const gg = await guestD();
    console.log(
      '[GUEST AIM DIAG]',
      JSON.stringify({
        cameraMode: gg.cameraMode,
        phase: gg.phase,
        current: gg.currentPlayerId,
        local: gg.localPlayerId,
        hasFired: gg.hasFired,
        lost: gg.connectionLost,
        rejected: gg.online?.rejectedCount,
        turnId: gg.turnId,
        cameraEventLog: gg.cameraEventLog,
      })
    );
    throw error;
  }
  const guestFired2 = (await guestD()).hasFired === true;
  const hostFiredEcho = await waitFor(
    pageHost,
    async () => (await hostD()).hasFired === true,
    5000,
    'Host 收到 FIRE 广播（后台事件循环）'
  );
  check('Guest Fire 经 Host 验证广播（双端发射）', guestFired2 && hostFiredEcho);

  // Guest 前台：本地炮弹结算 → RESOLVE → dwell（'waiting'，等 Host TURN_END）
  const guestResolved = await waitFor(
    pageGuest,
    async () => (await guestD()).phase === 'RESOLVE',
    25000,
    'Guest 本地结算 RESOLVE'
  );
  check('Guest 本地模拟完成结算（表现层，不碰权威 HP）', guestResolved);

  // Host 前台：其炮弹（冻结恢复后）飞行结算 → TURN_RESULT → TURN_END → P1 Turn 3
  await pageHost.bringToFront();
  const hostToP1 = await waitFor(
    pageHost,
    async () => {
      const d = await hostD();
      return d.currentPlayerId === 'P1' && d.phase === 'ACTION' && d.turnId === 3;
    },
    25000,
    'Host 进入 P1 Turn 3'
  );
  check('Host 结算并授权 → P1 回合（Host 权威）', hostToP1);

  // Guest 前台：应用 buffered TURN_RESULT + TURN_END → P1 Turn 3
  await pageGuest.bringToFront();
  const guestToP1 = await waitFor(
    pageGuest,
    async () => {
      const d = await guestD();
      return d.currentPlayerId === 'P1' && d.phase === 'ACTION' && d.turnId === 3;
    },
    25000,
    'Guest 进入 P1 Turn 3'
  );
  check('P1 → P2 → P1 完整循环（双端回合一致）', guestToP1);

  const hFinal = await hostD();
  const gFinal = await guestD();
  check('循环后双端 HP 一致', JSON.stringify(hFinal.hp) === JSON.stringify(gFinal.hp));
  check('循环后双端位置一致', JSON.stringify(hFinal.players) === JSON.stringify(gFinal.players));
  check(
    'stateHash 双端一致（基础 desync 探针，Guest 视角）',
    gFinal?.online?.lastHashMatch === true
  );

  // —— Phase 15：Force Desync → 自动检测 → 快照恢复 → 对局继续 ——
  // P1 Turn 3（Host 回合）内篡改 Guest 本地 turnId（唯一可靠篡改面）：
  // 下一次 TURN_RESULT 边界 hash mismatch → STATE_SYNC_REQUEST →
  // STATE_SNAPSHOT → Guest apply → ACK(recovered) → TURN_END 放行
  await pageGuest.evaluate(() => window.__RR_DEBUG__.forceDesync());
  const hostP2x2 = (await hostD()).players.P2;
  await pageHost.bringToFront(); // 后台页 rAF 冻结：瞄准/炮弹物理必须前台
  await fireFortyFiveShot(pageHost, 1280, 800, hostP2x2);
  // Guest 恢复为事件驱动（不依赖前台）；断言收紧到本回合的恢复记录
  //（防早期回合偶发恢复的 SYNCED_AFTER_RECOVERY 遗留误判）
  const guestRecovered = await waitFor(
    pageGuest,
    async () => {
      const d = await guestD();
      return (
        d.syncState === 'SYNCED_AFTER_RECOVERY' &&
        typeof d.lastSyncReason === 'string' &&
        d.lastSyncReason.includes('RECOVERED(turn:3')
      );
    },
    25000,
    'Guest desync 自动恢复'
  ).catch(async () => {
    const d = await guestD();
    console.log(
      '[recovery-guest-diag]',
      JSON.stringify({
        cur: d.currentPlayerId, turn: d.turnId, phase: d.phase,
        cam: d.cameraMode, sync: d.syncState, reason: d.lastSyncReason,
        recovery: d.recoveryCount, lastRx: d.online?.lastRxType,
      })
    );
    return null;
  });
  check(
    'Force Desync：TURN_RESULT 边界检测 mismatch → 快照恢复（turn3 快照）',
    guestRecovered !== null
  );
  // Host 保持前台直到回合切换完成（炮弹物理 + TR + TURN_END 全链 rAF），
  // 之后才切 Guest 断言推进 —— 双页 rAF 冻结的既有 E2E 轮换纪律
  const hostContinued = await waitFor(
    pageHost,
    async () => {
      const d = await hostD();
      return d.currentPlayerId === 'P2' && d.turnId === 4;
    },
    25000,
    'Host 同步进入 P2 Turn 4'
  ).catch(async () => {
    const hd = await hostD();
    console.log(
      '[recovery-host-diag]',
      JSON.stringify({
        cur: hd.currentPlayerId, turn: hd.turnId, phase: hd.phase,
        cam: hd.cameraMode, lastTx: hd.online?.lastTxType, sync: hd.syncState,
        reason: hd.lastSyncReason,
      })
    );
    return null;
  });
  check('恢复后对局继续（Turn Barrier 放行 → P2 Turn 4）', hostContinued);
  await pageGuest.bringToFront();
  const guestContinueAfterRecovery = await waitFor(
    pageGuest,
    async () => {
      const d = await guestD();
      return d.currentPlayerId === 'P2' && d.phase === 'ACTION' && d.turnId === 4;
    },
    25000,
    'Guest 恢复后继续 P2 Turn 4'
  );
  check('恢复后双端回合一致（Guest 应用授权回合）', guestContinueAfterRecovery);
  const hPost = await hostD();
  const gPost = await guestD();
  check(
    '恢复后双端 HP / 位置一致（Host 权威快照生效）',
    JSON.stringify(hPost.hp) === JSON.stringify(gPost.hp) &&
      JSON.stringify(hPost.players) === JSON.stringify(gPost.players)
  );
  check(
    '恢复诊断：lastSyncReason 记录 desync 事件',
    typeof gPost.lastSyncReason === 'string' && gPost.lastSyncReason.length > 0
  );

  // —— Phase 16：Online Rematch（自然终局 → Result → 双方 REMATCH → 新局）——
  // P2 Turn 4：Guest 开火（瞄 P1，不追求命中），回合回 P1 Turn 5 后注入
  // P2 hp=1，Host 精确命中 → gameOver → Result → Rematch。
  // 前台轮换纪律：先让 Host 前台完成 Turn 4 的相机转场（phase END →
  // ACTION —— 后台页 rAF 冻结会让 Host 卡 END，Guest 的 FIRE_REQUEST
  // 将被 phase 门禁拒绝），再切 Guest 发射。
  await pageHost.bringToFront();
  const hostReadyT4 = await waitFor(
    pageHost,
    async () => {
      const d = await hostD();
      return d.currentPlayerId === 'P2' && d.phase === 'ACTION' && d.turnId === 4;
    },
    15000,
    'Host Turn 4 进入 ACTION（转场完成）'
  );
  check('Phase 16 Rematch 前置：Host Turn 4 就绪', hostReadyT4);
  await pageGuest.bringToFront();
  await waitFor(
    pageGuest,
    async () => (await guestD()).cameraMode === 'FREE_VIEW',
    // 全量套件下后台页 rAF 恢复显著慢于单段运行（两次全量 123/124 同点
    // 失败、单段 29/29 通过）—— 与邻居等待（15s/25s）对齐
    15000,
    'Guest 相机回 FREE_VIEW（转场完成，瞄准入口就绪）'
  ).catch(async (e) => {
    // 卡点诊断：相机事件环形日志（Phase 14 利器）+ 同步状态 —— 定位
    // desync 恢复后相机滞留 IMPACT 的事件序列
    const d = await guestD();
    const log = await pageGuest.evaluate(() => window.__RR_DEBUG__.cameraEventLog ?? null);
    throw new Error(
      `${e.message} [diag cam=${d.cameraMode} phase=${d.phase} cur=${d.currentPlayerId} turn=${d.turnId} fired=${d.hasFired}] [camLog=${JSON.stringify(log)}]`
    );
  });
  await fireFortyFiveShot(pageGuest, 1280, 800, (await hostD()).players.P1).catch((e) => {
    console.log('[rematch-guest-fire-diag]', String(e).slice(0, 150));
    return null;
  });
  const guestFiredT4 = await waitFor(
    pageGuest,
    async () => (await guestD()).hasFired === true,
    10000,
    'Guest P2 Turn 4 已发射'
  ).catch(async () => {
    const d = await guestD();
    console.log(
      '[rematch-fired-diag]',
      JSON.stringify({ cam: d.cameraMode, phase: d.phase, fired: d.hasFired, cur: d.currentPlayerId, turn: d.turnId })
    );
    return false;
  });
  check('Phase 16 Rematch 前置：Guest Turn 4 发射', guestFiredT4);
  // 炮弹飞行/结算双端都要前台 rAF —— Host 切前台推进 Turn 4 收口
  await pageHost.bringToFront();
  const backToP1 = await waitFor(
    pageHost,
    async () => {
      const d = await hostD();
      return d.currentPlayerId === 'P1' && d.phase === 'ACTION' && d.turnId === 5;
    },
    25000,
    'Host 回到 P1 Turn 5'
  );
  check('Phase 16 Rematch 前置：Turn 4 收口回 P1', backToP1);
  await pageHost.evaluate(() => window.__RR_DEBUG__.setHp('P2', 1));
  await fireFortyFiveShot(pageHost, 1280, 800, (await hostD()).players.P2);
  const hostGameOver = await waitFor(
    pageHost,
    async () => (await hostD()).gameOver === true,
    25000,
    'Host gameOver'
  );
  await pageHost.bringToFront();
  const hostAtResult = await waitFor(
    pageHost,
    async () => (await dbg(pageHost)).scene === 'ResultScene',
    15000,
    'Host 进 ResultScene'
  );
  check('Phase 16 终局：Host 自然击杀 → ResultScene', hostGameOver && hostAtResult);
  await pageGuest.bringToFront();
  const guestAtResult = await waitFor(
    pageGuest,
    async () => (await dbg(pageGuest)).scene === 'ResultScene',
    15000,
    'Guest 进 ResultScene（gameOver hash gate 放行）'
  );
  check('Phase 16 终局：Guest 同步进 ResultScene', guestAtResult);
  const hostResultText = (await dbg(pageHost)).resultText ?? '';
  const guestResultText = (await dbg(pageGuest)).resultText ?? '';
  check(
    'Phase 16 终局视角：Host WIN / Guest LOSE',
    hostResultText.includes('YOU WIN') && guestResultText.includes('YOU LOSE')
  );

  // 双方点 REMATCH → 新 GAME_START → 新对局（HP 重置 / 新 matchId）
  await pageHost.bringToFront();
  const hostRematchBtn = (await dbg(pageHost)).buttons.rematch;
  await pageHost.mouse.click(
    hostRematchBtn.x + hostRematchBtn.width / 2,
    hostRematchBtn.y + hostRematchBtn.height / 2
  );
  await pageGuest.bringToFront();
  const guestRematchBtn = (await dbg(pageGuest)).buttons.rematch;
  await pageGuest.mouse.click(
    guestRematchBtn.x + guestRematchBtn.width / 2,
    guestRematchBtn.y + guestRematchBtn.height / 2
  );
  // Host 立即回前台：Guest 的 PLAYER_READY 会触发 Host 的 startGame →
  // scene.start(Battle) —— Phaser 场景启动需要 rAF tick，后台页冻结会
  // 让 Host 永远停在 Result（真人场景面前页面自然前台，不受影响）
  await pageHost.bringToFront();
  const hostInNewBattle = await waitFor(
    pageHost,
    async () => {
      const d = await dbg(pageHost);
      return d.scene === 'BattleScene' && d.hp && d.hp.P1 === 10 && d.hp.P2 === 10 && d.turnId === 1;
    },
    15000,
    'Host 进新对局（全新 HP / Turn 1）'
  ).catch(async () => {
    const hd = await dbg(pageHost);
    const gd = await dbg(pageGuest);
    console.log(
      '[rematch-newgame-diag]',
      JSON.stringify({
        hostScene: hd.scene, hostPhase: hd.rematchPhase, hostBusy: hd.busy, hostInfo: hd.rematchInfo,
        guestScene: gd.scene, guestPhase: gd.rematchPhase,
      })
    );
    return false;
  });
  await pageGuest.bringToFront();
  const guestInNewBattle = await waitFor(
    pageGuest,
    async () => {
      const d = await dbg(pageGuest);
      return d.scene === 'BattleScene' && d.hp && d.hp.P1 === 10 && d.hp.P2 === 10 && d.turnId === 1;
    },
    15000,
    'Guest 进新对局（全新 HP / Turn 1）'
  );
  check(
    'Phase 16 Rematch：同一 WebRTC 连接复用 → 双方全新对局（HP 10/10、Turn 1）',
    hostInNewBattle && guestInNewBattle
  );

  // —— Disconnect：Guest 优雅关闭通道（真实关标签页路径）→ Host 感知 ——
  // 进程异常崩溃只到 ICE 'disconnected'（瞬态，Phase 12 防误杀设计），
  // 'failed' 终局需数十秒 —— E2E 走确定性优雅关闭路径。
  await pageGuest.evaluate(() => window.__RR_DEBUG__.closeOnlineChannel());
  // 先等 Host 感知优雅关闭（SCTP close 送达）再关页面 —— 消除 close 与页面
  // 销毁的竞态（实测全量负载下浏览器 RST 可能先于 SCTP close 刷出，Host
  // 只见 transient disconnected → 15s 超时假失败；若 close 真未送达，
  // waitFor 依旧在此如实超时）
  const hostLost = await waitFor(
    pageHost,
    async () => (await hostD()).connectionLost === true,
    15_000,
    'Host 感知断线'
  );
  await pageGuest.close();
  await pageHost.bringToFront();
  const lostBanner = await waitFor(
    pageHost,
    async () => ((await hostD()).lastBannerText ?? '').includes('OPPONENT DISCONNECTED'),
    5000,
    '断线横幅'
  ).catch(() => null);
  if (hostLost && lostBanner === null) {
    // Phase 15 ACK barrier 后引入的时序 flaky 诊断：断线已感知但横幅未现
    const diag = await hostD();
    console.log(
      `[disconnect-flaky-diag] banner=${JSON.stringify(diag.lastBannerText)}`,
      `sync=${diag.syncState ?? 'n/a'}`,
      `reason=${diag.lastSyncReason ?? 'n/a'}`,
      `recovery=${diag.recoveryCount ?? 'n/a'}`,
      `hp=${JSON.stringify(diag.hp)}`,
      `turn=${diag.turnId}`,
      `gameOver=${diag.gameOver}`,
    );
  }
  check(
    'Disconnect 基本处理：冻结输入 + OPPONENT DISCONNECTED 横幅',
    hostLost && lostBanner !== null
  );

  await pageHost.close();
}

// ---- Online Room 场景（SG-5：Room Code + 自动信令 + Trickle 全链路）------

/**
 * SG-5 E2E：spawn 真实 Signaling Server（server/signaling，tsx 直跑）→
 * 双页 Room 流配对（CREATE/JOIN → 房间码 → 自动 SDP/Trickle → VERIFIED）→
 * 复用 driveOnlineBattle 完成对战 / Rematch / Disconnect。
 * Signaling 地址经 evaluateOnNewDocument 注入 window.__RR_SIGNALING_URL__
 * （构建产物无 env 重Build依赖），端口 8791 避开默认 8787（防与本机开发服冲突）。
 */
async function startSignalingServer(port) {
  const child = spawn(
    'npx',
    // cwd 指向 server/signaling：tsx 只装在该 workspace（根目录 npx 会走
    // registry 下载 → 探测超时，实测坑）；服务器内部 import 相对文件路径解析
    ['tsx', 'src/index.ts'],
    { shell: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: 'server/signaling', env: { ...process.env, PORT: String(port) } },
  );
  child.stdout?.on('data', (d) => console.log('[SIGNALING]', String(d).trim()));
  child.stderr?.on('data', (d) => console.log('[SIGNALING-ERR]', String(d).trim()));
  const stop = () => {
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: true });
    } else {
      child.kill();
    }
  };
  // 就绪探测：TCP connect 即可（Node 22.11 无全局 WebSocket 构造器——实测
  // `WebSocket is not defined`；WS 握手由页面真实链路覆盖）
  const portOpen = () =>
    new Promise((resolve) => {
      const socket = net.createConnection({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
  const started = Date.now();
  for (;;) {
    if (await portOpen()) {
      console.log(`[SIGNALING] ready at ws://127.0.0.1:${port}`);
      return stop;
    }
    if (Date.now() - started > 30_000) {
      stop();
      throw new Error('signaling server 就绪探测超时');
    }
    await sleep(400);
  }
}

/** 保持恢复窗口打开，验证跨帧输入锁及已认领拖拽的取消。底层 RTC 保留存活。 */
async function verifyRecoveryInputLock(page) {
  await page.bringToFront();
  await page.keyboard.press('Space');
  await waitFor(page, async () => (await dbg(page)).cameraMode === 'AIMING', 5000, '恢复前瞄准');
  const origin = await launchOriginScreen(page, 1280, 800);
  await page.mouse.move(origin.x, origin.y - 60);
  await page.mouse.down();
  let pointerHeld = true;
  await page.mouse.move(origin.x + 100, origin.y + 30, { steps: 4 });
  const before = await dbg(page);
  await page.evaluate(() => {
    const pc = window.__RR_E2E_PC__;
    Object.defineProperty(pc, 'connectionState', { configurable: true, get: () => 'failed' });
    window.__RR_DEBUG__.forceConnectionLost();
  });
  try {
    await waitFor(page, async () => (await dbg(page)).recoveryState === 'RECONNECTING', 5000, '持续重连窗口');
    await page.mouse.up(); // 恢复前已认领的手势也不得在松手时发射
    pointerHeld = false;
    await page.keyboard.down('a');
    await page.keyboard.press('Space');
    await sleep(350);
    await page.keyboard.up('a');
    const locked = await dbg(page);
    check('重连跨帧禁止移动、重新瞄准及旧拖拽发射',
      locked.recoveryState === 'RECONNECTING' &&
      locked.players.P2 === before.players.P2 && !locked.hasFired &&
      locked.projectileCount === 0 && locked.cameraMode === 'FREE_VIEW' &&
      locked.online?.lastTxType !== 'FIRE_REQUEST' && locked.online?.lastTxType !== 'MOVE_REQUEST');
  } finally {
    await page.keyboard.up('a');
    if (pointerHeld) await page.mouse.up();
    await page.evaluate(() => {
      const pc = window.__RR_E2E_PC__;
      delete pc.connectionState;
      pc.dispatchEvent(new Event('connectionstatechange'));
    });
  }
  await waitFor(page, async () => (await dbg(page)).recoveryState === 'RECOVERED', 15000, '输入锁测试后恢复');
  await waitFor(page, async () => (await dbg(page)).syncState === 'SYNCED_AFTER_RECOVERY', 15000, '输入锁测试后对账');
}

async function runOnlineRoom(browser) {
  section('Online Room — Room Code pairing（真实 Signaling Server + WebRTC 双页对战）');
  const stopSignaling = await startSignalingServer(8791);

  const newRoomPage = async (label) => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log(`[${label} PAGEERROR]`, e.message));
    page.on('console', (m) => console.log(`[${label} console.${m.type()}]`, m.text().slice(0, 200)));
    await page.evaluateOnNewDocument((u) => {
      window.__RR_SIGNALING_URL__ = u;
      const NativePeerConnection = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends NativePeerConnection {
        constructor(config) {
          super(config);
          window.__RR_E2E_PC__ = this;
          this.addEventListener('datachannel', (event) => { window.__RR_E2E_CHANNEL__ = event.channel; });
        }
      };
    }, 'ws://127.0.0.1:8791');
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(URL, { waitUntil: 'load' });
    await waitForScene(page, 'MainMenuScene', 15000);
    await clickMenuButton(page, 'online');
    await waitForScene(page, 'OnlineConnectionScene', 5000);
    return page;
  };

  try {
    const pageHost = await newRoomPage('HOST');
    const pageGuest = await newRoomPage('GUEST');

    check('默认流 = Room（无 manual-sdp 参数）', (await dbg(pageHost)).flow === 'room');

    // Host：CREATE GAME → ROOM_WAITING + 房间码（服务器生成）
    await clickMenuButton(pageHost, 'create');
    const roomCode = await waitFor(
      pageHost,
      async () => {
        const d = await dbg(pageHost);
        return d.roomState === 'ROOM_WAITING' ? d.roomCode : null;
      },
      20_000,
      'Host 房间码',
    );
    check(
      'Host 房间码 6 位高可读（排除 0/O/1/I/L）',
      /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(roomCode),
      roomCode,
    );

    // —— SG-7 失败 UX 全链路：错误码 → 分类文案 → TRY AGAIN → 非法码 → 输入保留 → 真码直连 ——
    await clickMenuButton(pageGuest, 'join');
    await pageGuest.evaluate(() => window.__RR_DEBUG__.setInputText('ZZZZZ9'));
    await clickMenuButton(pageGuest, 'joinConfirm');
    const notFound = await waitFor(
      pageGuest,
      async () => {
        const d = await dbg(pageGuest);
        return d.roomState === 'FAILED' && d.roomFailure?.reason === 'SERVER_ERROR' && d.roomFailure?.code === 'ROOM_NOT_FOUND';
      },
      10_000,
      'Guest 不存在房间失败',
    );
    const notFoundText = (await dbg(pageGuest)).statusText ?? '';
    check(
      'SG-7 失败分类：ROOM_NOT_FOUND（SERVER_ERROR.code 保留）+ 简洁文案 + Debug reason 后缀',
      notFound && notFoundText.includes('not found') && notFoundText.includes('[SERVER_ERROR:ROOM_NOT_FOUND]'),
      notFoundText,
    );

    // TRY AGAIN → IDLE → 非法码（含字符 1）→ INVALID_ROOM_CODE + 输入保留
    await clickMenuButton(pageGuest, 'tryAgain');
    await waitFor(pageGuest, async () => (await dbg(pageGuest)).roomState === 'IDLE', 5000, 'Guest retry 回 IDLE');
    await clickMenuButton(pageGuest, 'join');
    await pageGuest.evaluate(() => window.__RR_DEBUG__.setInputText('ABC1EF'));
    await clickMenuButton(pageGuest, 'joinConfirm');
    const invalidCode = await waitFor(
      pageGuest,
      async () => {
        const d = await dbg(pageGuest);
        return d.roomState === 'FAILED' && d.roomFailure?.reason === 'INVALID_ROOM_CODE';
      },
      5000,
      'Guest 非法码失败',
    );
    const invalidState = await dbg(pageGuest);
    check(
      'SG-7 失败分类：INVALID_ROOM_CODE + 输入保留（textarea 带码、JOIN 可直接重试）',
      invalidCode && (invalidState.statusText ?? '').includes('Invalid room code') && invalidState.inputText === 'ABC1EF',
      invalidState.statusText ?? '',
    );

    // 输入保留路径：直接改真码再按 JOIN（onJoinConfirm 内 retry + joinRoom）→ 正常配对
    await pageGuest.evaluate((code) => window.__RR_DEBUG__.setInputText(code), roomCode);
    await clickMenuButton(pageGuest, 'joinConfirm');
    const verifiedHost = await waitFor(
      pageHost,
      async () => (await dbg(pageHost)).roomState === 'VERIFIED',
      30_000,
      'Host VERIFIED',
    );
    const verifiedGuest = await waitFor(
      pageGuest,
      async () => (await dbg(pageGuest)).roomState === 'VERIFIED',
      30_000,
      'Guest VERIFIED',
    );
    check(
      'Room 配对 VERIFIED（自动 SDP + Trickle ICE，真实 DataChannel）',
      verifiedHost && verifiedGuest,
      `room=${roomCode}`,
    );

    // SG-6 诊断：真实浏览器 getStats → selected pair + 直连判定（本地 host 对）
    const diag = await pageHost.evaluate(() => window.__RR_DEBUG__.awaitRtcDiagnostics());
    check(
      'RTC 诊断：selected candidate pair 可读（getStats）',
      diag?.selectedPair != null,
      JSON.stringify(diag?.selectedPair ?? null),
    );
    check(
      'RTC 诊断：本地 P2P 路由判定 = DIRECT（无 TURN 部署时的基线）',
      diag?.route === 'DIRECT',
      `route=${diag?.route} types=${JSON.stringify(diag?.localCandidateTypes ?? [])}`,
    );

    await driveOnlineBattle(pageHost, pageGuest, {
      beforeFirstFire: async (_pageHost, pageGuest) => {
        await pageGuest.evaluate(() => {
          const channel = window.__RR_E2E_CHANNEL__;
          const intercept = (event) => {
            if (JSON.parse(event.data).type !== 'TURN_END') return;
            // 模拟 TURN_END 尚未应用就进入恢复：快照必须独立恢复下一回合。
            event.stopImmediatePropagation();
            channel.removeEventListener('message', intercept, true);
            window.__RR_E2E_TURN_END_INTERCEPTED__ = true;
            window.__RR_DEBUG__.forceConnectionLost();
          };
          channel.addEventListener('message', intercept, true);
        });
      },
      /**
       * SG-8 ICE Restart 恢复场景：debug 注入模拟连接失败（真实 pc 存活）→
       * 后续是真实 createOffer({iceRestart:true}) 经活信令服务器的全协商。
       * Host 侧验证 restart 发起/应答链；Guest 侧验证恢复后 Phase 15 对账
       * （CONNECTION_RECOVERED → 权威快照全链）。
       */
      onMidBattle: async (pageHost, pageGuest) => {
        const recoveredTurn = await dbg(pageGuest);
        check('回合切换期间恢复：未应用 TURN_END 也能恢复到 ACTION / FREE_VIEW',
          await pageGuest.evaluate(() => window.__RR_E2E_TURN_END_INTERCEPTED__ === true) &&
          recoveredTurn.recoveryState === 'RECOVERED' && recoveredTurn.syncState === 'SYNCED_AFTER_RECOVERY' &&
          recoveredTurn.phase === 'ACTION' && recoveredTurn.cameraMode === 'FREE_VIEW' && recoveredTurn.turnId === 2);
        await verifyRecoveryInputLock(pageGuest);
        // Host 侧：模拟失败 → RECONNECTING → 真实 restart offer 交换 → RECOVERED
        await pageHost.evaluate(() => window.__RR_DEBUG__.forceConnectionLost());
        const hostRecovered = await waitFor(
          pageHost,
          async () => (await dbg(pageHost)).recoveryState === 'RECOVERED',
          30_000,
          'Host ICE restart RECOVERED'
        );
        const hostAfter = await dbg(pageHost);
        check(
          'SG-8 Host 恢复：限次 ICE restart 经活信令完成 + 对局未终局',
          hostRecovered && hostAfter.recoveryAttemptCount >= 1 && hostAfter.connectionLost === false,
          `attempts=${hostAfter.recoveryAttemptCount}`
        );

        // Guest 侧（后台页恢复纯事件循环）：RECOVERED → Phase 15 对账
        await pageGuest.evaluate(() => window.__RR_DEBUG__.forceConnectionLost());
        const guestRecovered = await waitFor(
          pageGuest,
          async () => (await dbg(pageGuest)).recoveryState === 'RECOVERED',
          30_000,
          'Guest ICE restart RECOVERED'
        );
        const guestSynced = await waitFor(
          pageGuest,
          async () => {
            const g = await dbg(pageGuest);
            return g.syncState === 'SYNCED_AFTER_RECOVERY' && (g.recoveryCount ?? 0) >= 1;
          },
          15_000,
          'Guest 恢复后 Phase 15 对账'
        );
        const hRec = await dbg(pageHost);
        const gRec = await dbg(pageGuest);
        check(
          'SG-8 恢复后 Phase 15 对账：CONNECTION_RECOVERED → 权威快照 → 双端 parity',
          guestRecovered &&
            guestSynced &&
            (hRec.lastSyncReason ?? '').includes('CONNECTION_RECOVERED') &&
            hRec.turnId === gRec.turnId &&
            hRec.hp.P1 === gRec.hp.P1 &&
            hRec.hp.P2 === gRec.hp.P2,
          `hostReason=${hRec.lastSyncReason} guestRecoveries=${gRec.recoveryCount} turn=${hRec.turnId}/${gRec.turnId}`
        );
      },
    });
  } finally {
    stopSignaling();
  }
}

// ---- 主流程 --------------------------------------------------------------

async function main() {
  const executablePath = BROWSER_CANDIDATES.find((p) => existsSync(p));
  if (!executablePath) {
    console.error('未找到系统 Chrome / Edge，E2E 中止');
    process.exit(1);
  }
  console.log(`浏览器: ${executablePath}`);

  const stopServer = await startPreview();
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--mute-audio',
      // 双页 P2P 测试：后台 page 的 rAF/timer 节流会冻结 Phaser 场景
      // 启动链与 fade 完成（实测 Host 后台化后 MainMenuScene 停留 pending），
      // 强制禁用后台节流保证两页同时活跃
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      // macOS 实测（2026-09-29）：Chrome 的 mDNS host 候选（.local 假名）在
      // 本机/测试环境解析失败（疑似本地网络多播被权限挡），双页 ICE 永远
      // checking→failed；关掉 mDNS 混淆后 host 候选变真实 IP，直连立即成功。
      // Windows 上该 flag 同样无害（真实 IP 候选同样可连）。
      '--disable-features=WebRtcHideLocalIpsWithMdns',
    ],
  });

  let exitCode = 0;
  const only = process.env.RR_E2E_ONLY; // 调试：RR_E2E_ONLY=online npm run e2e
  try {
    if (!only || only === 'desktop') await runDesktop(browser);
    if (!only || only === 'mobile') await runMobile(browser);
    if (!only || only === 'sp') await runSinglePlayer(browser);
    if (!only || only === 'online') await runOnlineP2P(browser);
    if (!only || only === 'battle') await runOnlineBattle(browser);
    if (!only || only === 'online-room') await runOnlineRoom(browser);
  } catch (error) {
    failed++;
    failures.push(`场景异常: ${error.message}`);
    console.error(`\n✘ 场景异常: ${error.message}`);
    exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
    stopServer();
  }

  console.log(`\n========== E2E 结果: ${passed} passed, ${failed} failed ==========`);
  if (failures.length > 0) {
    console.log('失败项:');
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
    exitCode = 1;
  }
  process.exit(exitCode);
}

main();
