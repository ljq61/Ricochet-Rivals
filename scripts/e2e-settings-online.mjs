/** Real mobile WebRTC settings, remote turns and confirmed Host/Guest exit regression. */
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
async function settingsTap(page, name) {
  const b = (await debug(page)).settings.buttons[name];
  if (!b?.visible) throw new Error(`Missing visible settings action ${name}`);
  await page.touchscreen.tap(b.x, b.y);
}
async function leave(page) {
  await settingsTap(page, 'gear');
  await settingsTap(page, 'leave');
  check('return button requires confirmation', (await debug(page)).settings.phase === 'confirm');
  await settingsTap(page, 'confirm');
  await waitFor(page, d => d.scene === 'MainMenuScene', 'confirmed exit', 1500);
  check('confirmed exit removes settings DOM', await page.$('.rr-battle-settings') === null);
}
async function run(pages) {
  const [host, guest] = pages;
  for (const exitRole of ['Host', 'Guest']) {
    await pair(host, guest);
    await settingsTap(guest, 'gear');
    const turn = await fireTouch(host);
    const settled = await Promise.all(pages.map(page => waitFor(page, d => d.scene === 'BattleScene' &&
      d.turnId === turn + 1 && d.phase === 'ACTION' && d.cameraMode === 'FREE_VIEW', 'next turn with Guest modal open')));
    check('remote attack and turn progress continue while settings is open', settled[1].settings.phase === 'settings' &&
      settled[1].currentPlayerId === 'P2' && settled[0].turnId === settled[1].turnId);
    check('modal does not introduce desync or hash mismatch', settled[1].online.lastHashMatch === true &&
      settled[0].online.localHash === settled[1].online.localHash && settled[1].recoveryCount === 0);
    // Outside the dialog: test the mask rather than accidentally pressing Resume.
    await guest.touchscreen.touchStart(800, 300);
    await guest.touchscreen.touchMove(700, 300);
    await pause(250);
    await guest.touchscreen.touchEnd();
    const masked = await debug(guest);
    check('mask blocks gameplay gestures after remote turn hands over', masked.settings.isOpen &&
      Math.abs(masked.players.P2 - settled[1].players.P2) < 1 &&
      Math.abs(masked.cameraScrollX - settled[1].cameraScrollX) < 1);
    await settingsTap(guest, 'leave');
    await settingsTap(guest, 'cancel');
    check('cancel returns to settings without leaving WebRTC battle', (await debug(guest)).settings.phase === 'settings');
    await settingsTap(guest, 'resume');
    await settingsTap(host, 'gear');
    await settingsTap(host, 'resume');
    const h = await debug(host);
    await host.touchscreen.touchStart(h.moveButtons.right.x, h.moveButtons.right.y);
    await pause(200);
    await host.touchscreen.touchEnd();
    check('closing settings preserves remote-turn input lock', Math.abs((await debug(host)).players.P1 - h.players.P1) < 1);
    const exiting = exitRole === 'Host' ? host : guest;
    const remaining = exitRole === 'Host' ? guest : host;
    await leave(exiting);
    await waitFor(remaining, d => d.scene === 'BattleScene' && d.connectionLost, `${exitRole} disconnect notification`, 3000);
    check(`${exitRole} intentional exit locks the other peer without reconnection`,
      (await debug(remaining)).recoveryState !== 'RECONNECTING');
    await pause(1000);
    check(`${exitRole} stays in MainMenu after late callbacks`, (await debug(exiting)).scene === 'MainMenuScene');
    await leave(remaining);
    await tapButton(exiting, 'local2p');
    await waitFor(exiting, d => d.scene === 'BattleScene' && d.phase === 'ACTION', 'local match after online exit');
    check('new match has one settings root and unlocked state', await exiting.$$eval('.rr-battle-settings', xs => xs.length) === 1 &&
      !(await debug(exiting)).settings.isOpen);
    await leave(exiting);
  }
}
async function main() {
  let preview = null, exitCode = 0;
  const browsers = [], errors = [];
  try {
    if (!browserPath) throw new Error('No system Chrome or Edge found');
    let baseUrl = process.env.RR_E2E_URL;
    if (!baseUrl) {
      if (!existsSync('dist/index.html')) throw new Error('Run npm run build first');
      const port = Number(process.env.RR_E2E_PORT ?? 4341);
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
  console.log(`Settings online mobile E2E: ${checks} passed, ${exitCode} failed`);
  process.exit(exitCode);
}
await main();
