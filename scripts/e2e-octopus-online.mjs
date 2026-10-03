/** Real WebRTC + mobile touch regression for octopus damage, laser, recovery and final state.
 * npm run build && node scripts/e2e-octopus-online.mjs
 * RR_E2E_URL can use an existing local preview; otherwise this script owns a Vite preview.
 * Two separate headless browsers keep both Phaser animation loops running in the foreground.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { installRoarProbe, roarStarts, explosionStarts } from './e2e-audio-probe.mjs';

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
      if (d?.scene !== 'BattleScene') return;
      const hazard = d.octopusState, visual = hazard.visual;
      window.__RR_ONLINE_OCTOPUS_TRACE__.push({
        t: performance.now(), turn: d.turnId, phase: hazard.attackPhase,
        deathProgress: hazard.deathProgress, bodyCount: hazard.bodyCount,
        turnPhase: d.phase, cameraMode: d.cameraMode,
        cameraScrollX: d.cameraScrollX, cameraZoom: d.cameraZoom, uiScale: d.uiScale,
        pending: hazard.pendingHit, target: hazard.lastAttackTarget,
        hp: { ...d.hp }, displayHp: { ...hazard.displayHp },
        lastAttackTurnId: hazard.lastAttackTurnId, recoveryCount: d.recoveryCount,
        visual: visual ? { tip: { ...visual.tip }, end: visual.end ? { ...visual.end } : null,
          angle: visual.angle, progress: visual.progress, target: visual.target } : null,
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
async function verifyLaserTrace(samples, turn, peer, booms) {
  try {
    const attack = samples.filter((s) => s.lastAttackTurnId === turn);
    const focus = attack.find((s) => s.phase === 'focusing');
    const charge = attack.find((s) => s.phase === 'charging');
    const hold = attack.find((s) => s.phase === 'holding');
    const sweep = attack.find((s) => s.phase === 'sweeping');
    const idle = attack.find((s) => s.phase === 'idle' && s.t > (sweep?.t ?? Infinity));
    check(`${peer}: camera focus, charge, hold, sweep and completion render in order`,
      Boolean(focus && charge && hold && sweep && idle) && focus.t < charge.t &&
      charge.t < hold.t && hold.t < sweep.t && sweep.t < idle.t);
    for (const [label, duration, min, max] of [
      ['camera focus 450 ms', charge.t - focus.t, 400, 800],
      ['particle charge 500 ms', hold.t - charge.t, 450, 800],
      ['hold 200 ms', sweep.t - hold.t, 160, 500],
      ['moving laser sweep 800 ms', idle.t - sweep.t, 740, 1200],
    ]) {
      check(`${peer}: ${label}`, duration >= min && duration <= max, `${Math.round(duration)} ms`);
    }
    check(`${peer}: base endpoint plays exactly one real explosion`, booms.length === 1 &&
      booms[0].state === 'running' && booms[0].gain > 0 &&
      booms[0].at >= sweep.t + 700 && booms[0].at <= idle.t + 50);
    const active = attack.filter((s) => s.phase !== 'idle');
    const premature = active.filter((s) => s.turnPhase === 'ACTION' || s.cameraMode === 'TURN_TRANSITION');
    check(`${peer}: next action and camera transition wait for the entire laser animation`,
      premature.length === 0, JSON.stringify(premature.slice(0, 3)));
    check(`${peer}: camera reaches the tentacle before charging starts`, Boolean(charge.visual) &&
      Math.abs(charge.cameraScrollX + WIDTH * charge.uiScale / 2 - charge.visual.tip.x) < 100);
    check(`${peer}: HP display holds one laser hit through focus, charge, hold and most of the sweep`,
      active.filter((s) => s.phase !== 'sweeping' || s.visual?.progress < 0.9).every((s) =>
        s.pending && s.displayHp[s.target] === s.hp[s.target] + 1));
    check(`${peer}: hold completes before sweep progress begins`,
      attack.filter((s) => ['focusing', 'charging', 'holding'].includes(s.phase))
        .every((s) => (s.visual?.progress ?? 0) === 0));
    const swept = attack.filter((s) => s.phase === 'sweeping' && s.visual?.end);
    check(`${peer}: sweep exposes beam geometry`, swept.length > 1);
    const first = swept[0], last = swept.at(-1);
    const targetAngle = first.target === 'P1' ? 2 * Math.PI / 3 : Math.PI / 3;
    check(`${peer}: laser starts 30 degrees toward its target from vertical down`,
      first.visual.progress <= 0.1 && Math.abs(first.visual.angle - targetAngle) < 0.15,
      `${(first.visual.angle * 180 / Math.PI).toFixed(1)} degrees, q=${first.visual.progress.toFixed(3)}`);
    const dockX = last.target === 'P1' ? 475 : 4525;
    const reached = idle.visual;
    check(`${peer}: sweep reaches the selected base`, last.visual.progress >= 0.9 &&
      reached?.progress === 1 && Boolean(reached.end) &&
      Math.abs(reached.end.x - dockX) < 2 && Math.abs(reached.end.y - 960) < 2,
      JSON.stringify({ lastSampleProgress: last.visual.progress, final: reached }));
    const direction = last.target === 'P1' ? -1 : 1;
    check(`${peer}: camera moves with the sweeping beam toward the selected base`,
      (last.cameraScrollX - first.cameraScrollX) * direction > 100);
    const cameraErrors = swept.map((s) => {
      const halfVisible = WIDTH * s.uiScale / s.cameraZoom / 2;
      const focusX = 2500 + (s.visual.end.x - 2500) * s.visual.progress;
      const expected = halfVisible >= 2500 ? 2500
        : Math.max(halfVisible, Math.min(5000 - halfVisible, focusX));
      const actual = s.cameraScrollX + WIDTH * s.uiScale / 2;
      return Math.abs(actual - expected);
    });
    check(`${peer}: camera follows the moving beam each frame within viewport bounds`,
      cameraErrors.every((error) => error <= 180), `max error ${Math.max(...cameraErrors).toFixed(1)} world px`);
  } catch (error) {
    await writeFile(`/private/tmp/rr-octopus-${peer.replace(/[^a-zA-Z]/g, '-')}-turn-${turn}-trace.json`,
      JSON.stringify(samples, null, 2));
    throw error;
  }
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
  const beforeBoom = (await Promise.all(pages.map(explosionStarts))).map((starts) => starts.length);
  const turn = await fireTouch(shooter);
  const [host, guest] = await nextTurn(pages, turn);
  const samples = await Promise.all(pages.map(stopTrace));
  await verifyLaserTrace(samples[0], turn, 'Host', (await explosionStarts(pages[0])).slice(beforeBoom[0]));
  await verifyLaserTrace(samples[1], turn, 'Guest', (await explosionStarts(pages[1])).slice(beforeBoom[1]));
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
  check('both new matches begin with an unspawned fifteen-HP tentacle', (await Promise.all(pages.map(debug)))
    .every((d) => d.octopusState.hp === 15 && d.octopusState.spawnTurnId === null));
  await setBoth(pages, 10, 6, { hp: 15, spawnTurnId: 1, lastResolvedTurnId: 5,
    lastAttackTurnId: null, lastAttackTarget: null });
  await pause(1600); // The emergence animation is presentation only.
  let [h, g] = await laserRound(pages, host, 19, 0);
  check('Host shot changes authority to Guest for the next action', h.currentPlayerId === 'P2');
  for (let i = 0; i < 2; i++) {
    const actor = h.currentPlayerId === 'P1' ? host : guest;
    const skippedTurn = await fireTouch(actor);
    [h, g] = await nextTurn(pages, skippedTurn);
    sameBoundary(h, g, `skipped laser turn ${skippedTurn}`);
    check(`both peers skip intervening action ${i + 1}`, h.hp.P1 + h.hp.P2 === 19 &&
      g.hp.P1 + g.hp.P2 === 19 && h.octopusState.lastAttackTurnId === skippedTurn - i - 1);
  }
  [h, g] = await laserRound(pages, guest, 18, 0);
  check('Guest fire intent was accepted and returned the next action to Host', h.currentPlayerId === 'P1');
  await host.screenshot({ path: '/private/tmp/rr-octopus-online-mobile.png' });

  // Normal center-hit projectile, not a debug kill, destroys both obstacle mirrors.
  const history = { hp: 2, spawnTurnId: 1, lastResolvedTurnId: h.turnId - 1,
    lastAttackTurnId: h.octopusState.lastAttackTurnId, lastAttackTarget: h.octopusState.lastAttackTarget };
  await setBoth(pages, null, h.turnId, history);
  for (const page of pages) await trace(page);
  let turn = await fireTouch(host, 2500);
  await Promise.all(pages.map((page) => waitFor(page, (d) =>
    d.octopusState.attackPhase === 'dissolving' && d.octopusState.deathProgress >= 0.3, 'peer dissolves')));
  await host.screenshot({ path: '/private/tmp/rr-octopus-death-online.png' });
  [h, g] = await nextTurn(pages, turn);
  const deathTraces = await Promise.all(pages.map(stopTrace));
  for (const [i, peer] of ['Host', 'Guest'].entries()) {
    const samples = deathTraces[i].filter((s) => s.phase === 'dissolving');
    check(`${peer}: collision removed immediately and dissolution advances gradually`, samples.length >= 10 &&
      samples[0].deathProgress < 0.15 && samples.at(-1).deathProgress > 0.85 &&
      samples.every((s, j) => s.bodyCount === 0 && (j === 0 || s.deathProgress >= samples[j - 1].deathProgress)));
    check(`${peer}: turn and camera transition wait for the death animation`, samples.every((s) =>
      s.turn === turn && s.turnPhase !== 'ACTION' && s.cameraMode !== 'TURN_TRANSITION'));
    const roar = await roarStarts(pages[i]);
    check(`${peer}: actual monster roar plays once`, roar.length === 1 && roar[0].state === 'running' && roar[0].duration > 2 && roar[0].gain >= 0.9 && roar[0].rms > 0.2);
  }
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

  check('state recovery never replays the death roar on either peer',
    (await Promise.all(pages.map(roarStarts))).every((starts) => starts.length === 1));

  // Test the actual final laser animation/confirmation path after recovery.
  await setBoth(pages, 1, h.turnId, { hp: 15, spawnTurnId: 1, lastResolvedTurnId: h.turnId - 1,
    lastAttackTurnId: history.lastAttackTurnId, lastAttackTarget: history.lastAttackTarget });
  await pause(1600);
  for (const page of pages) await trace(page);
  const finalBoom = (await Promise.all(pages.map(explosionStarts))).map((starts) => starts.length);
  turn = await fireTouch(guest);
  const results = await Promise.all(pages.map((page) => waitFor(page, (d) => d?.scene === 'ResultScene', 'laser lethal ResultScene')));
  const finalTraces = await Promise.all(pages.map(stopTrace));
  await verifyLaserTrace(finalTraces[0], turn, 'lethal Host', (await explosionStarts(host)).slice(finalBoom[0]));
  await verifyLaserTrace(finalTraces[1], turn, 'lethal Guest', (await explosionStarts(guest)).slice(finalBoom[1]));
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
      await installRoarProbe(page);
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
