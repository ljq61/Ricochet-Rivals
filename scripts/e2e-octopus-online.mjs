/** Real WebRTC + mobile touch regression for octopus damage, laser, recovery and final state.
 * npm run build && node scripts/e2e-octopus-online.mjs
 * RR_E2E_URL can use an existing local preview; otherwise this script owns a Vite preview.
 * Two separate headless browsers keep both Phaser animation loops running in the foreground.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
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
  const start = Date.now();
  let last;
  do {
    last = await debug(page);
    if (test(last)) return last;
    await pause(25);
  } while (Date.now() - start < timeout);
  throw new Error(`Timeout ${label}: ${JSON.stringify(last)}`);
}
async function tapButton(page, name) {
  const d = await debug(page), button = d.buttons?.[name];
  if (!button) throw new Error(`Missing ${d.scene} button ${name}`);
  await page.touchscreen.tap(button.x, button.y);
}
function screenPoint(worldX, worldY, d) {
  const w = WIDTH * d.uiScale, h = HEIGHT * d.uiScale;
  return {
    x: ((worldX - d.cameraScrollX - w / 2) * d.cameraZoom + w / 2) / d.uiScale,
    y: ((worldY - d.cameraScrollY - h / 2) * d.cameraZoom + h / 2) / d.uiScale,
  };
}
async function fireTouch(page, targetX = null) {
  let d = await waitFor(page, (d) => d?.scene === 'BattleScene' && d.phase === 'ACTION' &&
    d.cameraMode === 'FREE_VIEW', 'ready to aim');
  await page.touchscreen.tap(d.aimButtonBounds.x / d.uiScale, d.aimButtonBounds.y / d.uiScale);
  d = await waitFor(page, (d) => d.cameraMode === 'AIMING', 'touch aiming');
  const origin = screenPoint(d.players[d.currentPlayerId], 896, d);
  let release;
  if (targetX === null) {
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
async function trace(page) {
  await page.evaluate(() => {
    clearInterval(window.__RR_ONLINE_OCTOPUS_TIMER__);
    window.__RR_ONLINE_OCTOPUS_TRACE__ = [];
    window.__RR_ONLINE_OCTOPUS_TIMER__ = setInterval(() => {
      const d = window.__RR_DEBUG__;
      if (d?.scene === 'BattleScene') window.__RR_ONLINE_OCTOPUS_TRACE__.push({
        t: performance.now(), turn: d.turnId, phase: d.octopusState.attackPhase,
        turnPhase: d.phase, cameraMode: d.cameraMode,
        pending: d.octopusState.pendingHit, target: d.octopusState.lastAttackTarget,
        hp: d.hp, displayHp: d.octopusState.displayHp,
        lastAttackTurnId: d.octopusState.lastAttackTurnId,
        recoveryCount: d.recoveryCount,
      });
    }, 10);
  });
}
async function stopTrace(page) {
  return page.evaluate(() => {
    clearInterval(window.__RR_ONLINE_OCTOPUS_TIMER__);
    return window.__RR_ONLINE_OCTOPUS_TRACE__;
  });
}
async function nextTurn(pages, turn) {
  return Promise.all(pages.map((page) => waitFor(page, (d) => d?.scene === 'BattleScene' &&
    d.turnId === turn + 1 && d.phase === 'ACTION' && d.cameraMode === 'FREE_VIEW' &&
    d.octopusState.attackPhase === 'idle' && !d.octopusState.pendingHit, 'both peers settle next turn')));
}
function sameBoundary(host, guest, label) {
  const summary = (name, d) => ({ name, turn: d.turnId, current: d.currentPlayerId,
    phase: d.phase, recovery: d.recoveryCount, lastReason: d.lastSyncReason,
    localHash: d.online?.localHash, hostHash: d.online?.hostHash });
  const details = JSON.stringify([summary('Host', host), summary('Guest', guest)]);
  check(`${label}: same turn and current player`, host.turnId === guest.turnId &&
    host.currentPlayerId === guest.currentPlayerId, details);
  check(`${label}: same authoritative HP and hazard`, JSON.stringify(host.hp) === JSON.stringify(guest.hp) &&
    ['hp', 'spawnTurnId', 'lastResolvedTurnId', 'lastAttackTurnId', 'lastAttackTarget'].every((key) =>
      host.octopusState[key] === guest.octopusState[key]));
  check(`${label}: last authoritative hash matches on both peers`, guest.online.lastHashMatch === true &&
    host.online.localHash === guest.online.localHash, `${host.online.localHash}/${guest.online.localHash}`);
}
async function verifyLaserTrace(samples, turn, peer) {
  const charge = samples.find((s) => s.phase === 'charging' && s.lastAttackTurnId === turn);
  const sweep = samples.find((s) => s.phase === 'sweeping' && s.lastAttackTurnId === turn);
  check(`${peer}: charge and sweep both rendered for turn ${turn}`, Boolean(charge && sweep));
  const active = samples.filter((s) => s.phase === 'charging' || s.phase === 'sweeping');
  const premature = active.filter((s) => s.turnPhase === 'ACTION' || s.cameraMode === 'TURN_TRANSITION');
  if (premature.length) {
    await writeFile(`/private/tmp/rr-octopus-${peer.replace(/[^a-zA-Z]/g, '-')}-turn-${turn}-trace.json`,
      JSON.stringify(samples, null, 2));
  }
  check(`${peer}: next action and camera transition wait for the laser animation`, premature.length === 0,
    JSON.stringify(premature.slice(0, 3)));
  check(`${peer}: HP display holds one laser hit until the sweep`, charge.pending &&
    charge.displayHp[charge.target] === charge.hp[charge.target] + 1);
}
async function setBoth(pages, hp, turnId, octopus) {
  for (const page of pages) {
    await page.evaluate(({ hp, turnId, octopus }) => {
      if (hp !== null) {
        window.__RR_DEBUG__.setHp('P1', hp);
        window.__RR_DEBUG__.setHp('P2', hp);
      }
      window.__RR_DEBUG__.prepareOctopus(octopus, turnId);
    }, { hp, turnId, octopus });
    await waitFor(page, (d) => d.turnId === turnId && d.octopusState.hp === octopus.hp,
      'prepared authoritative test history');
  }
}
async function laserRound(pages, shooter, expectedHp, baselineRecovery) {
  for (const page of pages) await trace(page);
  const turn = await fireTouch(shooter);
  const [host, guest] = await nextTurn(pages, turn);
  const samples = await Promise.all(pages.map(stopTrace));
  await verifyLaserTrace(samples[0], turn, 'Host');
  await verifyLaserTrace(samples[1], turn, 'Guest');
  sameBoundary(host, guest, `turn ${turn}`);
  check(`turn ${turn}: random target agrees and one HP was removed`, host.octopusState.lastAttackTurnId === turn &&
    host.octopusState.lastAttackTarget === guest.octopusState.lastAttackTarget &&
    host.hp.P1 + host.hp.P2 === expectedHp);
  check(`turn ${turn}: no recovery interrupted the laser`, guest.recoveryCount === baselineRecovery);
  check(`turn ${turn}: both laser animations completed`, host.octopusState.attackPhase === 'idle' &&
    guest.octopusState.attackPhase === 'idle' && !host.octopusState.pendingHit && !guest.octopusState.pendingHit);
  return [host, guest];
}
async function pair(host, guest) {
  for (const page of [host, guest]) {
    await waitFor(page, (d) => d?.scene === 'MainMenuScene', 'menu');
    await tapButton(page, 'online');
    await waitFor(page, (d) => d?.scene === 'OnlineConnectionScene', 'manual connection');
  }
  await tapButton(host, 'create');
  const hostCode = (await waitFor(host, (d) => Boolean(d.connectionCode), 'Host offer')).connectionCode;
  await tapButton(guest, 'join');
  await waitFor(guest, (d) => d.state === 'GUEST_WAITING_FOR_OFFER', 'Guest waiting for offer');
  await guest.evaluate((code) => window.__RR_DEBUG__.setInputText(code), hostCode);
  await tapButton(guest, 'createResponse');
  const guestCode = (await waitFor(guest, (d) => Boolean(d.connectionCode), 'Guest answer')).connectionCode;
  await host.evaluate((code) => window.__RR_DEBUG__.setInputText(code), guestCode);
  await tapButton(host, 'connect');
  await Promise.all([host, guest].map((page) => waitFor(page, (d) => d.state === 'VERIFIED', 'real WebRTC verified', 30000)));
  check('real WebRTC DataChannel is verified on both mobile pages', true);
  await tapButton(guest, 'enterBattle');
  await waitFor(guest, (d) => d.lobbyPhase === 'waiting', 'Guest PLAYER_READY');
  await tapButton(host, 'enterBattle');
  const peers = await Promise.all([host, guest].map((page) => waitFor(page, (d) => d?.scene === 'BattleScene' &&
    d.phase === 'ACTION' && d.cameraMode === 'FREE_VIEW', 'online battle started')));
  check('Host P1 / Guest P2 retain mobile touch controls at DPR 2', peers[0].localPlayerId === 'P1' &&
    peers[1].localPlayerId === 'P2' && peers.every((d) => d.controlProfile === 'touch' && d.uiScale === 2));
}
async function run(pages) {
  const [host, guest] = pages;
  await pair(host, guest);
  await setBoth(pages, 10, 6, { hp: 10, spawnTurnId: 1, lastResolvedTurnId: 5,
    lastAttackTurnId: null, lastAttackTarget: null });
  await pause(1600); // The emergence animation is presentation only.
  let [h, g] = await laserRound(pages, host, 19, 0);
  check('Host shot changes authority to Guest for the next action', h.currentPlayerId === 'P2');
  [h, g] = await laserRound(pages, guest, 18, 0);
  check('Guest fire intent was accepted and returned the next action to Host', h.currentPlayerId === 'P1');
  await host.screenshot({ path: '/private/tmp/rr-octopus-online-mobile.png' });

  // Normal center-hit projectile, not a debug kill, destroys both obstacle mirrors.
  const history = { hp: 2, spawnTurnId: 1, lastResolvedTurnId: h.turnId - 1,
    lastAttackTurnId: h.octopusState.lastAttackTurnId, lastAttackTarget: h.octopusState.lastAttackTarget };
  await setBoth(pages, null, h.turnId, history);
  let turn = await fireTouch(host, 2500);
  [h, g] = await nextTurn(pages, turn);
  sameBoundary(h, g, 'tentacle destroyed');
  check('normal center hit removes 2 HP, tentacle art and Matter obstacle on both peers', [h, g].every((d) =>
    d.octopusState.hp === 0 && !d.octopusState.active && d.octopusState.bodyCount === 0));
  check('destroying the tentacle suppresses the scheduled laser', h.octopusState.lastAttackTurnId === turn - 1 &&
    h.hp.P1 + h.hp.P2 === 18 && g.recoveryCount === 0);

  turn = await fireTouch(guest);
  [h, g] = await nextTurn(pages, turn);
  check('dead tentacle remains absent on the following Guest turn', [h, g].every((d) =>
    d.octopusState.hp === 0 && d.octopusState.bodyCount === 0));
  // Existing force-desync hook changes Guest turn ID; the next actual Host result
  // recovers through STATE_SYNC_REQUEST / STATE_SNAPSHOT / ACK, including history.
  await guest.evaluate(() => window.__RR_DEBUG__.forceDesync());
  turn = await fireTouch(host);
  // The corrupted Guest counter already equals the next turn, so ACTION/turnId
  // alone is a false positive until its snapshot episode has actually finished.
  await waitFor(guest, (d) => d?.scene === 'BattleScene' && d.recoveryCount === 1 &&
    d.syncState === 'SYNCED_AFTER_RECOVERY', 'Guest snapshot episode completed');
  [h, g] = await nextTurn(pages, turn);
  sameBoundary(h, g, 'snapshot recovery');
  check('snapshot recovery preserves death and never replays the historical laser', g.recoveryCount === 1 &&
    g.octopusState.hp === 0 && g.octopusState.bodyCount === 0 &&
    g.octopusState.lastAttackTurnId === history.lastAttackTurnId &&
    g.octopusState.attackPhase === 'idle' && !g.octopusState.pendingHit);

  // Test the actual final laser animation/confirmation path after recovery.
  await setBoth(pages, 1, h.turnId, { hp: 10, spawnTurnId: 1, lastResolvedTurnId: h.turnId - 1,
    lastAttackTurnId: history.lastAttackTurnId, lastAttackTarget: history.lastAttackTarget });
  await pause(1600);
  for (const page of pages) await trace(page);
  turn = await fireTouch(guest);
  const results = await Promise.all(pages.map((page) => waitFor(page, (d) => d?.scene === 'ResultScene', 'laser lethal ResultScene')));
  const finalTraces = await Promise.all(pages.map(stopTrace));
  await verifyLaserTrace(finalTraces[0], turn, 'lethal Host');
  await verifyLaserTrace(finalTraces[1], turn, 'lethal Guest');
  check('laser ends the match with the same winner on both peers', results[0].winnerId === results[1].winnerId &&
    ['P1', 'P2'].includes(results[0].winnerId));
  check('lethal laser introduces no extra desync recovery', finalTraces[1].every((s) => s.recoveryCount === 1));
  check('both pending visual hits were revealed before ResultScene', finalTraces.every((samples) =>
    samples.some((s) => s.lastAttackTurnId === turn && s.phase === 'idle' && !s.pending)));
}
async function main() {
  let preview = null, exitCode = 0;
  const browsers = [], errors = [];
  try {
    if (!browserPath) throw new Error('No system Chrome or Edge found');
    let baseUrl = process.env.RR_E2E_URL;
    if (!baseUrl) {
      if (!existsSync('dist/index.html')) throw new Error('Run npm run build first');
      const port = Number(process.env.RR_E2E_PORT ?? 4337);
      baseUrl = `http://127.0.0.1:${port}/`;
      preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1',
        '--port', String(port), '--strictPort'], { stdio: 'ignore' });
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (preview.exitCode !== null) throw new Error('Preview exited; choose another RR_E2E_PORT');
        try { if ((await fetch(baseUrl)).ok) { ready = true; break; } } catch { /* starting */ }
        await pause(100);
      }
      if (!ready) throw new Error('Preview startup timeout');
    }
    const url = new URL(baseUrl);
    url.searchParams.set('manual-sdp', '');
    const pages = [];
    for (const role of ['Host', 'Guest']) {
      const browser = await puppeteer.launch({ executablePath: browserPath, headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio',
          '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
      browsers.push(browser);
      const page = await browser.newPage();
      pages.push(page);
      page.on('pageerror', (error) => errors.push(`${role}: ${error.message}`));
      page.on('console', (message) => { if (message.type() === 'error') console.error(`[${role}] ${message.text().slice(0, 300)}`); });
      await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.goto(url.toString(), { waitUntil: 'load' });
    }
    await run(pages);
    check('no uncaught errors on either real WebRTC page', errors.length === 0, errors.join('; '));
  } catch (error) {
    exitCode = 1;
    console.error(`✘ ${error.stack ?? error}`);
  } finally {
    for (const browser of browsers) {
      await Promise.race([browser.close().catch(() => {}), pause(5000)]);
      browser.process()?.kill();
    }
    preview?.kill();
  }
  console.log(`Octopus online mobile E2E: ${checks} passed, ${exitCode} failed`);
  process.exit(exitCode);
}
await main();
