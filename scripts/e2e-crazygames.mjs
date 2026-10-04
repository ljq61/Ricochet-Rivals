/** Exercise the extracted upload ZIP, not Vite's dev server, under a nested iframe path. */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const archive = resolve(root, 'artifacts', `ricochet-rivals-crazygames-${version}.zip`);
const optimization = JSON.parse(await readFile(resolve(root, '.crazygames-assets-report.json'), 'utf8'));
const directory = await mkdtemp(resolve(tmpdir(), 'rr-crazygames-'));
const prefix = '/upload/random-session/';
const results = { checks: [], errors: [], screenshots: [], browser: '', archive, nestedPath: prefix };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.md': 'text/plain' };
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/frame.html') {
    response.setHeader('Content-Type', 'text/html');
    return response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style></head><body><iframe allow="fullscreen; autoplay" src="${prefix}index.html${url.search}"></iframe></body></html>`);
  }
  if (!url.pathname.startsWith(prefix)) { response.writeHead(404); return response.end(); }
  const path = resolve(directory, decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html');
  if (!path.startsWith(directory + '/')) { response.writeHead(403); return response.end(); }
  try {
    const bytes = await readFile(path);
    response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
let browser;
function check(label, condition, detail = '') {
  if (!condition) throw new Error(`${label}: ${detail}`);
  results.checks.push(label); console.log(`✔ ${label}`);
}
const debug = frame => frame.evaluate(() => window.__RR_DEBUG__);
async function waitFor(frame, predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let state;
  do { state = await debug(frame); if (state && predicate(state)) return state; await pause(30); } while (Date.now() < deadline);
  throw new Error(`Timeout ${label}: ${JSON.stringify(state)}`);
}
async function tap(page, rect, scale = 1) {
  if (page.viewport().hasTouch) await page.touchscreen.tap(rect.x / scale, rect.y / scale);
  else await page.mouse.click(rect.x / scale, rect.y / scale);
}
async function screenshot(page, name) {
  const path = resolve(tmpdir(), `rr-crazygames-${name}.png`);
  await page.screenshot({ path }); results.screenshots.push(path);
}
const inside = (rect, width, height) => rect.x - rect.width / 2 >= -1 && rect.y - rect.height / 2 >= -1 &&
  rect.x + rect.width / 2 <= width + 1 && rect.y + rect.height / 2 <= height + 1;
try {
  execFileSync('unzip', ['-q', archive, '-d', directory]);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.RR_BROWSER_PATH ?? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].find(existsSync);
  if (!executablePath) throw new Error('Set RR_BROWSER_PATH to Chrome or Edge');
  browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  results.browser = await browser.version();
  for (const [width, height, dpr, touch] of [[821, 462, 1, false], [907, 510, 1, false],
    [1216, 684, 1, false], [844, 390, 2, true], [568, 240, 2, true]]) {
    const label = `${width}x${height} DPR${dpr}`;
    const page = await browser.newPage();
    const resourceFailures = [];
    page.on('pageerror', error => results.errors.push(`${label}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') results.errors.push(`${label}: ${message.text()}`); });
    page.on('response', response => { if (response.status() >= 400) resourceFailures.push(`${response.status()} ${response.url()}`); });
    page.on('requestfailed', request => resourceFailures.push(`${request.failure()?.errorText} ${request.url()}`));
    await page.setViewport({ width, height, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
    await page.setCacheEnabled(false);
    const start = Date.now();
    await page.goto(`${base}/frame.html`, { waitUntil: 'load' });
    const frame = page.frames().find(frame => frame.url().includes(prefix));
    if (!frame) throw new Error('Game iframe missing');
    let d = await waitFor(frame, d => d.scene === 'MainMenuScene', label + ' menu', 60000);
    results[`${label} menuReadyMs`] = Date.now() - start;
    check(`${label}: correct nonempty game page without framework overlay`, frame.url() === base + prefix + 'index.html' &&
      await frame.evaluate(() => document.title === 'Ricochet Rivals' && !!document.querySelector('canvas') &&
        !document.querySelector('vite-error-overlay')));
    check(`${label}: English entry in iframe`, await frame.evaluate(() => document.documentElement.lang === 'en'));
    check(`${label}: platform full screen replaces custom control`, !d.buttons.fullscreen);
    check(`${label}: menu targets fit viewport`, Object.values(d.buttons).every(rect => inside(rect, width, height)));
    if (width === 821) {
      const decoded = await frame.evaluate(async assets => Promise.all(assets.map(asset => new Promise(resolve => {
        const image = new Image(); image.onload = () => resolve({ file: asset.destination,
          width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => resolve({ file: asset.destination, failed: true }); image.src = asset.destination;
      }))), optimization.assets.filter(asset => asset.dimensions));
      check('41 optimized images decode at original atlas dimensions', decoded.every((image, i) => !image.failed &&
        image.width === optimization.assets.filter(asset => asset.dimensions)[i].dimensions[0] &&
        image.height === optimization.assets.filter(asset => asset.dimensions)[i].dimensions[1]));
      const resources = await frame.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
      check('All local asset requests use nested relative paths', resources.every(url => url.startsWith(base + prefix)));
      check('No source PNG or JPEG downloaded', resources.every(url => !/\.(png|jpe?g)(?:\?|$)/i.test(url)));
      await screenshot(page, 'english-menu');
    }
    await tap(page, d.buttons.singlePlayer);
    d = await waitFor(frame, d => d.menuPage === 'difficulty', label + ' difficulty');
    check(`${label}: difficulty targets and text fit`, Object.values(d.buttons).every(rect => inside(rect, width, height)) &&
      Object.values(d.textRects).every(rect => inside(rect, width, height)));
    await tap(page, d.buttons.normal);
    d = await waitFor(frame, d => d.scene === 'BattleScene' && d.phase === 'ACTION' && d.aimIcon?.hintVisible, label + ' battle');
    check(`${label}: single player starts`, d.aiEnabled && d.currentPlayerId === 'P1');
    if (touch) {
      const initial = d.players.P1;
      const control = d.moveButtons.right;
      await page.touchscreen.touchStart(control.x, control.y); await pause(300); await page.touchscreen.touchEnd();
      d = await debug(frame);
      check(`${label}: real touch movement works inside iframe`, d.players.P1 > initial + 5);
    }
    await frame.evaluate(() => { window.__RR_DEBUG__.prepareItems({ P1: ['heal', 'homing', 'airstrike'] }); window.__RR_DEBUG__.setHp('P1', 8); });
    d = await debug(frame);
    if (d.itemState.hud.collapsed) { await tap(page, d.itemState.hud.bag, d.uiScale); d = await waitFor(frame, d => d.itemState.hud.expanded, 'backpack'); }
    check(`${label}: three usable inventory slots`, d.itemState.hud.slots.length === 3);
    await tap(page, d.itemState.hud.slots[0], d.uiScale);
    d = await waitFor(frame, d => d.hp.P1 === 10, 'heal accepted');
    check(`${label}: item use retains normal shot`, d.itemState.used.P1 && !d.hasFired);
    if (width === 844) await screenshot(page, 'english-mobile-battle');
    await frame.click('[data-action=gear]');
    await waitFor(frame, d => d.settings.phase === 'settings', 'settings');
    check(`${label}: settings translated`, await frame.$eval('#rr-settings-title', element => element.textContent === 'Settings'));
    check(`${label}: settings controls do not clip text`, await frame.$$eval('.rr-actions button', buttons => buttons.filter(button => button.getBoundingClientRect().height > 0)
      .every(button => button.scrollWidth <= button.clientWidth + 1)));
    if (width === 568) await screenshot(page, 'english-short-settings');
    await frame.click('[data-action=resume]'); await waitFor(frame, d => d.settings.phase === 'closed', 'resume');
    await frame.click('[data-action=gear]'); await frame.click('[data-action=leave]');
    check(`${label}: leave confirmation translated`, await frame.$eval('#rr-settings-title', element => element.textContent === 'Leave match'));
    await frame.click('[data-action=cancel]');
    check(`${label}: cancel retains match`, (await debug(frame)).settings.phase === 'settings');
    await frame.click('[data-action=leave]'); await frame.click('[data-action=confirm]');
    await waitFor(frame, d => d.scene === 'MainMenuScene', 'return to menu');
    check(`${label}: no failed game resources`, resourceFailures.length === 0, JSON.stringify(resourceFailures));
    await page.close();
  }
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390 });
  await page.goto(`${base}/frame.html?lang=zh`, { waitUntil: 'load' });
  const frame = page.frames().find(frame => frame.url().includes(prefix));
  const d = await waitFor(frame, d => d.scene === 'MainMenuScene', 'Chinese override');
  check('Explicit Chinese override preserves platform full screen policy', !d.buttons.fullscreen &&
    await frame.evaluate(() => document.documentElement.lang === 'zh-CN'));
  await page.close();
  check('No browser runtime or console errors', results.errors.length === 0, JSON.stringify(results.errors));
  if (process.env.RR_CRAZYGAMES_ITEMS === '1') {
    // Complete gameplay/mobile and real two-peer WebRTC regression against this exact extracted ZIP.
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/e2e-items.mjs'], { cwd: root, stdio: 'inherit',
        env: { ...process.env, RR_E2E_URL: base + prefix + 'index.html' } });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Items E2E exited ${code}`)));
    });
  }
} catch (error) {
  results.failure = error.stack ?? String(error); process.exitCode = 1; console.error(results.failure);
} finally {
  await writeFile(resolve(tmpdir(), 'rr-crazygames-e2e-results.json'), JSON.stringify(results, null, 2) + '\n');
  await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true });
}
console.log(`CrazyGames ZIP/iframe E2E: ${results.checks.length} passed; report ${resolve(tmpdir(), 'rr-crazygames-e2e-results.json')}`);
