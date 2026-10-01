/** Cold HTML, asset loading, first-frame handoff and warm reload on the built project base. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browserPath = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find(existsSync);
let checks = 0;
function check(label, passed) {
  if (!passed) throw new Error(label);
  checks++;
  console.log(`✔ ${label}`);
}
async function state(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#startup-loading');
    const art = document.querySelector('#startup-loading-art');
    const progress = document.querySelector('#startup-loading-progress');
    const box = root?.getBoundingClientRect();
    return { visible: !!root && !root.hidden && getComputedStyle(root).display !== 'none',
      width: box?.width, height: box?.height, scroll: document.documentElement.scrollWidth > innerWidth,
      art: !!art?.complete && art.naturalWidth > 0,
      value: Number(progress?.getAttribute('aria-valuenow')), scene: window.__RR_DEBUG__?.scene,
      title: document.querySelector('#startup-loading')?.textContent,
      rotate: document.querySelector('#rotate-overlay')?.classList.contains('is-visible') };
  });
}
async function waitFor(page, predicate, label) {
  const deadline = Date.now() + 20000;
  let last;
  do {
    last = await state(page);
    if (predicate(last)) return last;
    await pause(30);
  } while (Date.now() < deadline);
  throw new Error(`Timeout ${label}: ${JSON.stringify(last)}`);
}
async function cold(page, url, label, viewport, failArt = false, failLogo = false) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport(viewport);
  await page.setCacheEnabled(false);
  await page.setRequestInterception(true);
  let holdScripts = true, holdAssets = true;
  const scripts = [], assets = [];
  page.on('request', (request) => {
    if (failArt && request.url().includes('/loading-harbor.jpg')) return void request.abort();
    if (failLogo && /\/logo\.png(?:\?|$)/.test(request.url())) return void request.abort();
    if (holdScripts && request.resourceType() === 'script') scripts.push(request);
    else if (holdAssets && /\/harbor\.png(?:\?|$)/.test(request.url())) assets.push(request);
    else void request.continue();
  });
  const navigation = page.goto(url, { waitUntil: 'load', timeout: 60000 });
  // Deferred modules intentionally block DOMContentLoaded while the HTML is already visible.
  await page.waitForSelector('#startup-loading');
  await waitFor(page, (s) => s.visible && (failArt || s.art), 'HTML startup');
  let s = await state(page);
  check(`${label}: image/HTML visible before JavaScript`, s.visible && !s.scene && scripts.length > 0);
  check(`${label}: initial progress is zero`, s.value === 0);
  check(`${label}: fills viewport without horizontal overflow`, s.width === viewport.width && s.height === viewport.height && !s.scroll);
  check(`${label}: portrait is allowed during loading`, !s.rotate);
  if (failArt) check(`${label}: failed illustration retains loading text`, /加载|准备|LOADING/i.test(s.title));
  if (failLogo) {
    await page.waitForFunction(() => document.querySelector('#startup-title')?.hidden === false);
    check(`${label}: failed logo shows readable game title`, await page.$eval('#startup-title', (element) =>
      getComputedStyle(element).display !== 'none' && element.textContent === 'RICOCHET RIVALS'));
  }
  await page.screenshot({ path: `/private/tmp/rr-loading-${label}.png` });
  if (label === 'portrait') {
    await page.setViewport({ ...viewport, width: 844, height: 390 });
    s = await state(page);
    check('portrait: rotation keeps startup image and fits', s.visible && s.art && s.width === 844 && s.height === 390 && !s.scroll);
  }
  holdScripts = false;
  await Promise.all(scripts.splice(0).map((request) => request.continue()));
  s = await waitFor(page, (s) => s.value > 0 && s.value < 100 && assets.length > 0, 'real asset progress');
  check(`${label}: real asset progress advances while assets pending`, s.visible && !s.scene);
  await page.screenshot({ path: `/private/tmp/rr-loading-${label}-progress.png` });
  holdAssets = false;
  await Promise.all(assets.splice(0).map((request) => request.continue()));
  await navigation;
  await waitFor(page, (s) => !s.visible && s.scene === 'MainMenuScene', 'menu handoff');
  check(`${label}: loader removed after menu readiness`, await page.$('#startup-loading') === null);
  await page.screenshot({ path: `/private/tmp/rr-loading-${label}-menu.png` });
  await page.setCacheEnabled(true);
  await page.reload({ waitUntil: 'load' });
  await waitFor(page, (s) => !s.visible && s.scene === 'MainMenuScene', 'warm handoff');
  check(`${label}: warm reload reaches menu without leftover overlay`, await page.$('#startup-loading') === null);
  await page.reload({ waitUntil: 'load' });
  await waitFor(page, (s) => !s.visible && s.scene === 'MainMenuScene', 'cached reload');
  check(`${label}: cached reload also cleans startup overlay`, await page.$('#startup-loading') === null);
  if (label === 'mobile') {
    const tap = async (getButton) => {
      const button = await page.evaluate(getButton);
      await page.touchscreen.tap(button.x, button.y);
    };
    await tap(() => window.__RR_DEBUG__.buttons.local2p);
    await page.waitForFunction(() => window.__RR_DEBUG__?.scene === 'BattleScene' &&
      window.__RR_DEBUG__.phase === 'ACTION' && window.__RR_DEBUG__.settings?.phase === 'closed');
    check('mobile: menu input enters battle after loading', await page.$('#startup-loading') === null);
    await tap(() => window.__RR_DEBUG__.settings.buttons.gear);
    await page.waitForFunction(() => window.__RR_DEBUG__?.settings?.phase === 'settings');
    await tap(() => window.__RR_DEBUG__.settings.buttons.leave);
    await page.waitForFunction(() => window.__RR_DEBUG__?.settings?.phase === 'confirm');
    await tap(() => window.__RR_DEBUG__.settings.buttons.confirm);
    await waitFor(page, (s) => s.scene === 'MainMenuScene', 'return to menu');
    check('mobile: returning to menu does not recreate startup overlay', await page.$('#startup-loading') === null);
  }
  check(`${label}: no uncaught browser errors`, errors.length === 0);
}

let preview, browser, failed = 0;
try {
  if (!browserPath) throw new Error('No installed Chrome/Edge');
  let url = process.env.RR_E2E_URL;
  if (!url) {
    if (!existsSync('dist/index.html')) throw new Error('Run npm run build first');
    const port = Number(process.env.RR_E2E_PORT ?? 4342);
    url = `http://127.0.0.1:${port}/Ricochet-Rivals/`;
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (preview.exitCode !== null) throw new Error('Preview exited');
      try { if ((await fetch(url)).ok) { ready = true; break; } } catch { /* starting */ }
      await pause(100);
    }
    if (!ready) throw new Error('Preview startup timeout');
  }
  browser = await puppeteer.launch({ executablePath: browserPath, headless: true,
    args: ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage', '--disable-background-timer-throttling'] });
  const mobile = { deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  for (const [label, viewport, failArt, failLogo] of [
    ['desktop', { width: 1280, height: 720, deviceScaleFactor: 1 }, false],
    ['mobile', { width: 844, height: 390, ...mobile }, false],
    ['short-mobile', { width: 568, height: 320, ...mobile }, false],
    ['portrait', { width: 390, height: 844, ...mobile }, false],
    ['missing-art', { width: 844, height: 390, ...mobile }, true],
    ['missing-logo', { width: 844, height: 390, ...mobile }, false, true],
  ]) {
    const page = await browser.newPage();
    try { await cold(page, url, label, viewport, failArt, failLogo); } finally { await page.close(); }
  }
} catch (error) {
  failed = 1;
  console.error(error.stack ?? error);
} finally {
  await Promise.race([browser?.close().catch(() => {}), pause(5000)]);
  browser?.process()?.kill();
  preview?.kill();
}
console.log(`Startup loading E2E: ${checks} passed, ${failed} failed`);
process.exit(failed);
