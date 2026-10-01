/** Rendered mobile touch regression for the authoritative octopus hazard.
 * npm run build && node scripts/e2e-octopus.mjs
 * RR_E2E_URL may point at an existing preview server. Debug hooks only prepare
 * turn history / HP; damage and turn progression use normal touch-fired shots.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const WIDTH = 844, HEIGHT = 390;
const browserPath = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const debug = (page) => page.evaluate(() => window.__RR_DEBUG__);
let checks = 0;
function check(name, condition, details = '') {
  if (!condition) throw new Error(`${name}: ${details}`);
  checks++;
  console.log(`✔ ${name}${details ? ` (${details})` : ''}`);
}
async function waitFor(page, test, label, timeout = 15000) {
  const started = Date.now();
  let last;
  do {
    last = await debug(page);
    if (test(last)) return last;
    await pause(25);
  } while (Date.now() - started < timeout);
  throw new Error(`Timeout ${label}: ${JSON.stringify(last)}`);
}
async function tapButton(page, name) {
  const button = (await debug(page)).buttons[name];
  if (!button) throw new Error(`Missing button ${name}`);
  await page.touchscreen.tap(button.x, button.y);
}
function screenPoint(worldX, worldY, d) {
  const gameWidth = WIDTH * d.uiScale, gameHeight = HEIGHT * d.uiScale;
  return {
    x: ((worldX - d.cameraScrollX - gameWidth / 2) * d.cameraZoom + gameWidth / 2) / d.uiScale,
    y: ((worldY - d.cameraScrollY - gameHeight / 2) * d.cameraZoom + gameHeight / 2) / d.uiScale,
  };
}
async function fireTouch(page, targetX = null) {
  let d = await waitFor(page, (d) => d?.scene === 'BattleScene' &&
    d.phase === 'ACTION' && d.cameraMode === 'FREE_VIEW', 'ready to aim');
  await page.touchscreen.tap(d.aimButtonBounds.x / d.uiScale, d.aimButtonBounds.y / d.uiScale);
  d = await waitFor(page, (d) => d.cameraMode === 'AIMING', 'touch aiming');
  const origin = screenPoint(d.players[d.currentPlayerId], 896, d);
  let release;
  if (targetX === null) {
    // Horizontal outward shot promptly crosses the world edge, avoiding players
    // and the center obstacle while exercising the real out-of-bounds callback.
    const away = d.currentPlayerId === 'P1' ? -1 : 1;
    const drag = 180 * 0.7 * d.cameraZoom / d.uiScale;
    release = { x: origin.x - away * drag, y: origin.y };
  } else {
    const range = Math.abs(targetX - d.players[d.currentPlayerId]);
    const direction = Math.sign(targetX - d.players[d.currentPlayerId]);
    const power = Math.min(1, Math.max(0, (Math.sqrt(range * 1000) - 550) / 1850));
    const drag = 180 * power * d.cameraZoom / Math.SQRT2 / d.uiScale;
    release = { x: origin.x - drag * direction, y: origin.y + drag };
  }
  await page.touchscreen.touchStart(origin.x, origin.y - 60);
  await page.touchscreen.touchMove(release.x, release.y);
  await page.touchscreen.touchEnd();
  await waitFor(page, (d) => d.hasFired, 'touch shot accepted', 3000);
  return d.turnId;
}
async function prepare(page, hp, turnId, spawnTurnId = 1) {
  await page.evaluate(({ hp, turnId, spawnTurnId }) => {
    window.__RR_DEBUG__.prepareOctopus({ hp, spawnTurnId,
      lastResolvedTurnId: turnId - 1, lastAttackTurnId: null, lastAttackTarget: null }, turnId);
  }, { hp, turnId, spawnTurnId });
  return waitFor(page, (d) => d.octopusState?.hp === hp && d.turnId === turnId &&
    d.octopusState.active === (hp > 0 && spawnTurnId !== null), 'prepared hazard');
}
async function settledNextTurn(page, previousTurn) {
  return waitFor(page, (d) => d?.scene === 'BattleScene' && d.turnId === previousTurn + 1 &&
    d.phase === 'ACTION' && d.cameraMode === 'FREE_VIEW', 'next turn');
}
async function startTrace(page) {
  await page.evaluate(() => {
    clearInterval(window.__RR_OCTOPUS_TRACE_TIMER__);
    window.__RR_OCTOPUS_TRACE__ = [];
    window.__RR_OCTOPUS_TRACE_TIMER__ = setInterval(() => {
      const d = window.__RR_DEBUG__;
      if (d?.scene !== 'BattleScene') return;
      const hazard = d.octopusState;
      window.__RR_OCTOPUS_TRACE__.push({ t: performance.now(), phase: hazard.attackPhase,
        pending: hazard.pendingHit, turn: d.turnId, hp: d.hp,
        displayHp: hazard.displayHp ?? null, lastAttackTurnId: hazard.lastAttackTurnId });
    }, 10);
  });
}
async function laserTurn(page) {
  await startTrace(page);
  const turn = await fireTouch(page);
  const charging = await waitFor(page, (d) => d.octopusState.attackPhase === 'charging', 'laser charge');
  check('charged laser preserves turn ownership until presentation ends', charging.turnId === turn);
  check('charge keeps a pending visual hit', charging.octopusState.pendingHit === true);
  await page.screenshot({ path: '/private/tmp/rr-octopus-charging-mobile.png' });
  await waitFor(page, (d) => d.octopusState.attackPhase === 'sweeping', 'laser sweep');
  await page.screenshot({ path: '/private/tmp/rr-octopus-sweeping-mobile.png' });
  const next = await settledNextTurn(page, turn);
  const samples = await page.evaluate(() => {
    clearInterval(window.__RR_OCTOPUS_TRACE_TIMER__);
    return window.__RR_OCTOPUS_TRACE__;
  });
  const charge = samples.find((s) => s.phase === 'charging');
  const sweep = samples.find((s) => s.phase === 'sweeping');
  const end = samples.find((s) => s.t > sweep?.t && s.phase === 'idle');
  const chargeMs = sweep?.t - charge?.t, sweepMs = end?.t - sweep?.t;
  check('energy charge lasts 500 ms', chargeMs >= 450 && chargeMs <= 800, `${chargeMs.toFixed(0)} ms`);
  check('laser sweep lasts 600 ms', sweepMs >= 550 && sweepMs <= 900, `${sweepMs.toFixed(0)} ms`);
  check('one laser is recorded for the completed turn', next.octopusState.lastAttackTurnId === turn);
  const hpDuringCharge = samples.filter((s) => s.phase === 'charging' && s.displayHp !== null);
  if (hpDuringCharge.length) {
    const first = hpDuringCharge[0].displayHp;
    check('rendered HP stays stable during charge', hpDuringCharge.every((s) =>
      s.displayHp.P1 === first.P1 && s.displayHp.P2 === first.P2));
    const target = next.octopusState.lastAttackTarget;
    check('laser HP is revealed after charging', first[target] === next.hp[target] + 1);
  }
  return next;
}
async function run(page, url) {
  const pageErrors = [];
  page.on('pageerror', (error) => { pageErrors.push(error.message); console.error('[PAGEERROR]', error.message); });
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(url, { waitUntil: 'load' });
  await waitFor(page, (d) => d?.scene === 'MainMenuScene', 'main menu');
  await tapButton(page, 'local2p');
  let d = await waitFor(page, (d) => d?.scene === 'BattleScene' && d.phase === 'ACTION', 'local battle');
  check('mobile touch profile and DPR 2', d.controlProfile === 'touch' && d.uiScale === 2);
  check('new matches contain a ten-HP unspawned hazard', d.octopusState.hp === 10 &&
    d.octopusState.spawnTurnId === null && !d.octopusState.active);
  await prepare(page, 10, 2);
  await pause(1600); // emergence animation only; body is already authoritative
  for (let hp = 10; hp > 0; hp -= 2) {
    const turn = await fireTouch(page, 2500);
    d = await settledNextTurn(page, turn);
    check(`normal projectile direct hit reduces tentacle ${hp}→${hp - 2}`, d.octopusState.hp === hp - 2);
  }
  check('defeated tentacle has no active obstacle', !d.octopusState.active);
  if (typeof d.octopusState.bodyCount === 'number') {
    check('defeated Matter collision body is removed', d.octopusState.bodyCount === 0);
  }
  check('killing hit prevents first scheduled laser', d.octopusState.lastAttackTurnId === null);
  await page.evaluate(() => window.__RR_DEBUG__.setHp('P1', 4));
  let turn = await fireTouch(page);
  d = await settledNextTurn(page, turn);
  check('low player HP cannot respawn a defeated tentacle', d.octopusState.hp === 0 && !d.octopusState.active);

  await page.evaluate(() => { window.__RR_DEBUG__.setHp('P1', 10); window.__RR_DEBUG__.setHp('P2', 10); });
  await prepare(page, 10, 5);
  turn = await fireTouch(page);
  d = await settledNextTurn(page, turn);
  check('age four has no laser damage', d.octopusState.lastAttackTurnId === null && d.hp.P1 === 10 && d.hp.P2 === 10);
  d = await laserTurn(page);
  check('age five laser removes exactly one HP', d.hp.P1 + d.hp.P2 === 19);
  const stableHp = { ...d.hp };
  await pause(400);
  d = await debug(page);
  check('idle frames cannot repeat the last laser', d.hp.P1 === stableHp.P1 && d.hp.P2 === stableHp.P2);
  d = await laserTurn(page);
  check('next action turn also attacks exactly once', d.hp.P1 + d.hp.P2 === 18);

  await page.evaluate(() => { window.__RR_DEBUG__.setHp('P1', 1); window.__RR_DEBUG__.setHp('P2', 1); });
  await fireTouch(page);
  await waitFor(page, (d) => d?.scene === 'ResultScene', 'laser kills and opens result');
  check('laser death finishes the match', true);
  await tapButton(page, 'rematch');
  d = await waitFor(page, (d) => d?.scene === 'BattleScene' && d.phase === 'ACTION', 'rematch');
  check('rematch resets HP and all hazard history', d.hp.P1 === 10 && d.hp.P2 === 10 &&
    d.octopusState.hp === 10 && d.octopusState.spawnTurnId === null &&
    d.octopusState.lastAttackTurnId === null && !d.octopusState.active);
  await pause(1200);
  check('prior match laser callbacks cannot damage rematch', (await debug(page)).hp.P1 === 10 && (await debug(page)).hp.P2 === 10);
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join('; '));
}

async function main() {
  let preview = null, browser = null;
  let exitCode = 0;
  try {
    if (!browserPath) throw new Error('No system Chrome or Edge found');
    let url = process.env.RR_E2E_URL;
    if (!url) {
      if (!existsSync('dist/index.html')) throw new Error('Run npm run build first');
      const port = Number(process.env.RR_E2E_PORT ?? 4336);
      url = `http://127.0.0.1:${port}/`;
      preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview',
        '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (preview.exitCode !== null) throw new Error('Preview exited; choose another RR_E2E_PORT');
        try { if ((await fetch(url)).ok) { ready = true; break; } } catch { /* starting */ }
        await pause(100);
      }
      if (!ready) throw new Error('Preview startup timeout');
    }
    browser = await puppeteer.launch({ executablePath: browserPath, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
    await run(await browser.newPage(), url);
  } catch (error) {
    exitCode = 1;
    console.error(`✘ ${error.stack ?? error}`);
  } finally {
    await Promise.race([browser?.close().catch(() => {}), pause(5000)]);
    browser?.process()?.kill();
    preview?.kill();
  }
  console.log(`Octopus mobile E2E: ${checks} passed, ${exitCode} failed`);
  process.exit(exitCode);
}
await main();
