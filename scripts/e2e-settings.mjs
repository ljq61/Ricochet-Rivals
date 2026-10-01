/** Real mouse/touch/keyboard checks for in-battle settings. Build first, or set RR_E2E_URL. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const debug = (page) => page.evaluate(() => window.__RR_DEBUG__);
const browserPath = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
let checks = 0;
function check(label, passed, details = '') {
  if (!passed) throw new Error(`${label}: ${details}`);
  checks++;
  console.log(`✔ ${label}${details ? ` (${details})` : ''}`);
}
async function waitFor(page, test, label, timeout = 12000) {
  const started = Date.now();
  let last;
  do {
    last = await debug(page);
    if (test(last)) return last;
    await pause(25);
  } while (Date.now() - started < timeout);
  throw new Error(`Timeout ${label}: ${JSON.stringify(last)}`);
}
async function click(page, button, mobile) {
  if (!button?.visible && button?.visible !== undefined) throw new Error('Clicking hidden settings action');
  if (mobile) await page.touchscreen.tap(button.x, button.y);
  else await page.mouse.click(button.x, button.y);
}
async function action(page, name, mobile) {
  await click(page, (await debug(page)).settings.buttons[name], mobile);
}
async function enter(page, mobile) {
  const menu = await waitFor(page, (d) => d?.scene === 'MainMenuScene', 'main menu');
  await click(page, menu.buttons.local2p, mobile);
  return waitFor(page, (d) => d?.scene === 'BattleScene' && d.phase === 'ACTION' &&
    d.cameraMode === 'FREE_VIEW' && d.settings?.phase === 'closed', 'battle ready');
}
function inViewport(button, viewport) {
  return button.x - button.width / 2 >= 0 && button.y - button.height / 2 >= 0 &&
    button.x + button.width / 2 <= viewport.width && button.y + button.height / 2 <= viewport.height;
}
async function run(page, url, viewport, label) {
  const mobile = viewport.hasTouch;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport(viewport);
  await page.goto(url, { waitUntil: 'load' });
  let d = await enter(page, mobile);
  const turn = d.turnId;
  check(`${label}: correct input profile / DPR`, d.controlProfile === (mobile ? 'touch' : 'desktop') &&
    d.uiScale === viewport.deviceScaleFactor);
  check(`${label}: one gear per battle`, await page.$$eval('.rr-battle-settings .rr-gear', (elements) => elements.length === 1));
  const gear = d.settings.buttons.gear;
  check(`${label}: 48px gear below left portrait`, gear.width === 48 && gear.height === 48 &&
    gear.x >= 24 && gear.x <= 70 && gear.y - gear.height / 2 > 70 && inViewport(gear, viewport));
  if (label === 'mobile') await page.screenshot({ path: '/private/tmp/rr-battle-settings-gear-mobile.png' });

  await action(page, 'gear', mobile);
  d = await waitFor(page, (d) => d.settings.phase === 'settings', 'settings opened');
  for (const name of ['sound', 'leave', 'resume']) {
    const button = d.settings.buttons[name];
    check(`${label}: ${name} 48px target within viewport`, button.visible && button.height >= 48 &&
      button.width >= 48 && inViewport(button, viewport));
  }
  if (label === 'mobile') await page.screenshot({ path: '/private/tmp/rr-battle-settings-mobile.png' });
  if (!d.settings.soundEnabled) await action(page, 'sound', mobile);
  await action(page, 'sound', mobile);
  d = await debug(page);
  check(`${label}: sound turns off immediately`, !d.settings.soundEnabled);
  check(`${label}: sound off persisted`, await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ricochet-rivals:settings')).soundEnabled === false));
  await page.reload({ waitUntil: 'load' });
  const menu = await waitFor(page, (d) => d?.scene === 'MainMenuScene', 'sound persistence after reload');
  check(`${label}: reload preserves sound off`, menu.soundEnabled === false);
  d = await enter(page, mobile);
  await action(page, 'gear', mobile);
  await action(page, 'sound', mobile);
  d = await debug(page);
  check(`${label}: sound turns on`, d.settings.soundEnabled === true);
  check(`${label}: sound on persisted`, await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ricochet-rivals:settings')).soundEnabled === true));

  const before = await debug(page);
  if (mobile) {
    const move = before.moveButtons.left;
    await page.touchscreen.touchStart(move.x, move.y);
    await pause(300);
    await page.touchscreen.touchEnd();
    const aim = before.aimButtonBounds;
    await page.touchscreen.tap(aim.x / before.uiScale, aim.y / before.uiScale);
  } else {
    await page.keyboard.down('d'); await pause(300); await page.keyboard.up('d');
    await page.mouse.move(20, viewport.height - 40); await page.mouse.down();
    await page.mouse.move(100, viewport.height - 40, { steps: 4 }); await page.mouse.up();
  }
  await pause(100);
  d = await debug(page);
  check(`${label}: overlay blocks movement and aiming`, d.settings.phase === 'settings' &&
    d.players.P1 === before.players.P1 && d.phase === 'ACTION' && d.cameraMode === 'FREE_VIEW' && !d.hasFired);

  await action(page, 'leave', mobile);
  d = await waitFor(page, (d) => d.settings.phase === 'confirm', 'leave confirmation');
  check(`${label}: leaving first asks confirmation`, d.scene === 'BattleScene' && d.turnId === turn);
  for (const name of ['confirm', 'cancel']) {
    const button = d.settings.buttons[name];
    check(`${label}: ${name} target fits viewport`, button.visible && button.height >= 48 && inViewport(button, viewport));
  }
  if (label === 'mobile') await page.screenshot({ path: '/private/tmp/rr-battle-settings-confirm.png' });
  await action(page, 'cancel', mobile);
  d = await debug(page);
  check(`${label}: cancel preserves current battle`, d.scene === 'BattleScene' && d.turnId === turn && d.settings.phase === 'settings');
  await action(page, 'leave', mobile);
  await page.keyboard.press('Escape');
  d = await debug(page);
  check(`${label}: Escape returns confirmation to settings`, d.settings.phase === 'settings');
  await page.keyboard.press('Escape');
  d = await debug(page);
  check(`${label}: Escape closes settings`, d.settings.phase === 'closed');

  if (!mobile) {
    // No extra canvas click: closing must release DOM focus as well as Phaser key state.
    const initialX = d.players.P1;
    await page.keyboard.down('d'); await pause(250);
    d = await debug(page);
    check('desktop: keyboard movement works immediately after closing', d.players.P1 > initialX + 1);
    await action(page, 'gear', false);
    await page.keyboard.up('d'); // capture layer receives release while settings are open
    const stopped = await debug(page);
    await pause(250);
    check('desktop: held movement stops on open', (await debug(page)).players.P1 === stopped.players.P1);
    await action(page, 'resume', false);
    await pause(450);
    d = await debug(page);
    check('desktop: captured keyup cannot leave movement stuck', d.players.P1 === stopped.players.P1);
    await page.keyboard.press('Space');
    d = await waitFor(page, (d) => d.cameraMode === 'AIMING', 'Space immediately after resume');
    check('desktop: Space resumes aiming without reopening settings', d.settings.phase === 'closed');
    await action(page, 'gear', false);
    d = await waitFor(page, (d) => d.settings.phase === 'settings' && d.phase === 'ACTION' &&
      d.cameraMode === 'FREE_VIEW', 'opening settings cancels aim');
    check('desktop: opening during aim cancels it without firing', !d.hasFired && d.projectileCount === 0);
    await action(page, 'resume', false);
  }

  await action(page, 'gear', mobile);
  await action(page, 'leave', mobile);
  await action(page, 'confirm', mobile);
  d = await waitFor(page, (d) => d?.scene === 'MainMenuScene', 'confirmed return to menu');
  check(`${label}: menu retains sound on`, d.soundEnabled === true);
  check(`${label}: leaving removes settings DOM`, await page.$$eval('.rr-battle-settings', (elements) => elements.length === 0));
  d = await enter(page, mobile);
  check(`${label}: new match resets turn and settings`, d.turnId === 1 && d.settings.phase === 'closed');
  check(`${label}: re-entry creates exactly one gear`, await page.$$eval('.rr-battle-settings .rr-gear', (elements) => elements.length === 1));
  check(`${label}: no uncaught browser errors`, errors.length === 0, errors.join('; '));
}

async function main() {
  let preview = null, browser = null;
  let exitCode = 0;
  try {
    if (!browserPath) throw new Error('No system Chrome or Edge found');
    let url = process.env.RR_E2E_URL;
    if (!url) {
      if (!existsSync('dist/index.html')) throw new Error('Run npm run build first');
      const port = Number(process.env.RR_E2E_PORT ?? 4340);
      url = `http://127.0.0.1:${port}/`;
      preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host',
        '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (preview.exitCode !== null) throw new Error('Preview exited; choose another RR_E2E_PORT');
        try { if ((await fetch(url)).ok) { ready = true; break; } } catch { /* starting */ }
        await pause(100);
      }
      if (!ready) throw new Error('Preview startup timeout');
    }
    browser = await puppeteer.launch({ executablePath: browserPath, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding'] });
    for (const [label, viewport] of [
      ['mobile', { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
      ['short mobile', { width: 568, height: 320, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
      ['desktop', { width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false }],
    ]) {
      const page = await browser.newPage();
      try { await run(page, url, viewport, label); } finally { await page.close(); }
    }
  } catch (error) {
    exitCode = 1;
    console.error(`✘ ${error.stack ?? error}`);
  } finally {
    await Promise.race([browser?.close().catch(() => {}), pause(5000)]);
    browser?.process()?.kill();
    preview?.kill();
  }
  console.log(`Battle settings E2E: ${checks} passed, ${exitCode} failed`);
  process.exit(exitCode);
}
await main();
