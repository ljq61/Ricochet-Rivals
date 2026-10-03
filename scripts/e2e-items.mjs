/**
 * V0.2 item rules through real pointer input and an actual WebRTC DataChannel.
 * Run npm run build first, or set RR_E2E_URL to an existing preview.
 * QA preparation supplies inventory/crates; selection, firing, pickups, HP and
 * synchronization all use the production input and authoritative rule paths.
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { installHomingProbe, homingAudio, installAirstrikeProbe, airstrikeAudio } from './e2e-audio-probe.mjs';

const browserPath = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const debug = (page) => page.evaluate(() => window.__RR_DEBUG__);
const resultPath = '/tmp/rr-items-e2e-results.json';
const diagnostics = [];
const assertions = [];
const screenshots = [];
let browser = null;
let baseUrl = '';

function check(label, condition, detail = '') {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ''}`);
  assertions.push(label);
  console.log(`✔ ${label}`);
}

async function waitFor(page, predicate, label, timeoutMs = 15_000) {
  const started = Date.now();
  let last;
  do {
    last = await debug(page);
    if (last && predicate(last)) return last;
    await pause(25);
  } while (Date.now() - started < timeoutMs);
  throw new Error(`Timeout ${label}: ${JSON.stringify(last)}`);
}

async function makePage(label, width = 844, height = 390, dpr = 2, touch = true, manual = false, safe = null) {
  const page = await browser.newPage();
  await installHomingProbe(page);
  await installAirstrikeProbe(page);
  const record = { label, pageErrors: [], consoleErrors: [], failedResponses: [], failedRequests: [] };
  diagnostics.push(record);
  page.on('pageerror', (error) => record.pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') record.consoleErrors.push({ message: message.text(), location: message.location() });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) record.failedResponses.push({ url: response.url(), status: response.status(),
      resourceType: response.request().resourceType() });
  });
  page.on('requestfailed', (request) => record.failedRequests.push({ url: request.url(),
    resourceType: request.resourceType(), error: request.failure()?.errorText ?? 'unknown' }));
  await page.setViewport({ width, height, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
  if (safe) await page.evaluateOnNewDocument((safe) => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.style?.cssText.includes('safe-area-inset')) return {
        x: safe.left, y: safe.top, left: safe.left, top: safe.top,
        right: window.innerWidth - safe.right, bottom: window.innerHeight - safe.bottom,
        width: window.innerWidth - safe.left - safe.right,
        height: window.innerHeight - safe.top - safe.bottom, toJSON() { return this; },
      };
      return original.call(this);
    };
  }, safe);
  const url = new URL(baseUrl);
  if (manual) url.searchParams.set('manual-sdp', '');
  await page.goto(url.href, { waitUntil: 'load' });
  await waitFor(page, (d) => d.scene === 'MainMenuScene', `${label} menu`, 60_000);
  return page;
}

async function clickCanvas(page, rect) {
  if (!rect) throw new Error('Missing canvas control');
  const ui = (await debug(page)).uiScale ?? 1;
  if (page.viewport().hasTouch) await page.touchscreen.tap(rect.x / ui, rect.y / ui);
  else await page.mouse.click(rect.x / ui, rect.y / ui);
}

async function clickMenu(page, key) {
  const rect = (await debug(page)).buttons[key];
  if (!rect) throw new Error(`Missing menu action: ${key}`);
  if (page.viewport().hasTouch) await page.touchscreen.tap(rect.x, rect.y);
  else await page.mouse.click(rect.x, rect.y);
}

async function localBattle(label, width = 844, height = 390, dpr = 2, safe = null) {
  const page = await makePage(label, width, height, dpr, true, false, safe);
  await clickMenu(page, 'local2p');
  await waitFor(page, (d) => d.scene === 'BattleScene' && d.phase === 'ACTION', `${label} battle`);
  return page;
}

async function chooseSlot(page, index, label) {
  let d = await debug(page);
  if (d.itemState.hud.collapsed && !d.itemState.hud.expanded) {
    await clickCanvas(page, d.itemState.hud.bag);
    await waitFor(page, (d) => d.itemState.hud.expanded, `${label} expanded inventory`);
  }
  d = await debug(page);
  check(`${label}: three visible slots`, d.itemState.hud.slots.length === 3);
  await clickCanvas(page, d.itemState.hud.slots[index]);
}

async function fire(page, velocityX, velocityY) {
  // Fixture injection can start the crate entrance while already in ACTION.
  // Wait for the actual input gate; background RAF is not a wall-clock sleep.
  let d = await waitFor(page, (d) => d.phase === 'ACTION' && d.aimIcon?.hintVisible, 'local aim input ready');
  await clickCanvas(page, d.aimButtonBounds);
  d = await waitFor(page, (d) => d.cameraMode === 'AIMING' && d.phase === 'AIM', 'aiming');
  const ui = d.uiScale;
  const viewport = page.viewport();
  const width = viewport.width * ui, height = viewport.height * ui;
  const origin = {
    x: ((d.players[d.currentPlayerId] - d.cameraScrollX - width / 2) * d.cameraZoom + width / 2) / ui,
    y: ((896 - d.cameraScrollY - height / 2) * d.cameraZoom + height / 2) / ui,
  };
  const speed = Math.hypot(velocityX, velocityY);
  const drag = (speed - 550) / 1850 * 180 * d.cameraZoom / ui;
  const target = { x: origin.x - velocityX / speed * drag, y: origin.y - velocityY / speed * drag };
  if (viewport.hasTouch) {
    await page.touchscreen.touchStart(origin.x, origin.y);
    try {
      for (let step = 1; step <= 8; step++) await page.touchscreen.touchMove(
        origin.x + (target.x - origin.x) * step / 8, origin.y + (target.y - origin.y) * step / 8);
    } finally { await page.touchscreen.touchEnd(); }
  } else {
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    try { await page.mouse.move(target.x, target.y, { steps: 8 }); }
    finally { await page.mouse.up(); }
  }
  return waitFor(page, (d) => d.hasFired, 'accepted shot');
}

async function screenshot(page, name) {
  const path = `/tmp/rr-items-${name}.png`;
  await page.screenshot({ path });
  screenshots.push(path);
}

// Exercise screen anchoring through production touch gestures, including both teams.
async function runHudCases() {
  for (const [width, height, dpr, safe] of [[844, 390, 2], [667, 320, 2], [568, 256, 3], [568, 240, 2],
    [844, 240, 2, { left: 44, right: 44, top: 0, bottom: 34 }],
    [568, 180, 2, { left: 4, right: 4, top: 8, bottom: 20 }]]) {
    const page = await localBattle(`fixed HUD ${width}x${height}`, width, height, dpr, safe);
    try {
      check(`${width}x${height}: correct game page`, (await page.title()).includes('Ricochet') &&
        await page.$('vite-error-overlay') === null);
      for (const id of ['P1', 'P2']) {
        const label = `${width}x${height} ${id}`;
        let d = await waitFor(page, d => d.currentPlayerId === id && d.phase === 'ACTION' &&
          d.cameraMode === 'FREE_VIEW' && d.moveButtonsVisible && d.aimIcon?.hintVisible, `${label} controls ready`);
        check(`${label}: three slots visible without a bag`, !d.itemState.hud.collapsed &&
          d.itemState.hud.bag === null && d.itemState.hud.slots.length === 3);
        check(`${label}: slots form a compact team-side row`, d.itemState.hud.slots.every(slot =>
          slot.y === d.itemState.hud.slots[0].y && slot.width / d.uiScale === 48) &&
          (id === 'P1' ? d.itemState.hud.slots[0].x < width * d.uiScale / 2
            : d.itemState.hud.slots[0].x > width * d.uiScale / 2));
        const anchors = d => JSON.stringify({ move: d.moveButtons, items: d.itemState.hud.slots,
          aim: d.aimButtonBounds, gear: d.settings.buttons.gear });
        const before = anchors(d), scroll = d.cameraScrollX;
        const y = height * 0.55, start = width * 0.6;
        const distance = width * 0.3 * (id === 'P1' ? -1 : 1);
        await page.touchscreen.touchStart(start, y);
        try {
          for (let step = 1; step <= 10; step++) await page.touchscreen.touchMove(start + distance * step / 10, y);
        } finally { await page.touchscreen.touchEnd(); }
        d = await waitFor(page, d => Math.abs(d.cameraScrollX - scroll) > 30, `${label} camera pan`);
        check(`${label}: camera pan leaves arrows, inventory, aim and gear fixed`, anchors(d) === before);
        for (const direction of ['right', 'left']) {
          const initialX = d.players[id], point = d.moveButtons[direction];
          await page.touchscreen.touchStart(point.x, point.y);
          try {
            d = await waitFor(page, d => direction === 'right' ? d.players[id] > initialX + 10
              : d.players[id] < initialX - 10, `${label} ${direction} hold`);
            check(`${label}: ${direction} hold moves the player without moving buttons`, anchors(d) === before);
          } finally { await page.touchscreen.touchEnd(); }
          await pause(100);
          d = await debug(page);
          const stoppedX = d.players[id];
          await pause(100);
          d = await debug(page);
          check(`${label}: ${direction} release stops movement`, d.players[id] === stoppedX);
        }
        await page.touchscreen.tap(d.settings.buttons.gear.x, d.settings.buttons.gear.y);
        await waitFor(page, d => d.settings.phase === 'settings', `${label} settings opens`);
        let resume = (await debug(page)).settings.buttons.resume;
        if (resume.y + resume.height / 2 > height - (safe?.bottom ?? 0)) {
          await page.touchscreen.touchStart(width / 2, height - 25);
          try { await page.touchscreen.touchMove(width / 2, Math.max(30, height - 130)); }
          finally { await page.touchscreen.touchEnd(); }
          await pause(200);
          resume = (await debug(page)).settings.buttons.resume;
        }
        check(`${label}: resume remains reachable in a short settings panel`,
          resume.y > 0 && resume.y < height);
        await page.touchscreen.tap(resume.x, resume.y);
        d = await waitFor(page, d => d.settings.phase === 'closed', `${label} settings closes`);
        check(`${label}: settings returns to the same screen anchor`, anchors(d) === before);
        await clickCanvas(page, d.aimButtonBounds);
        d = await waitFor(page, d => d.phase === 'AIM' && d.cameraMode === 'AIMING', `${label} aim return`);
        await clickCanvas(page, d.aimButtonBounds);
        d = await waitFor(page, d => d.phase === 'ACTION' && d.moveButtonsVisible, `${label} aim cancellation`);
        check(`${label}: returning home and cancelling aim preserves anchors`, anchors(d) === before);
        await screenshot(page, `fixed-hud-${width}x${height}-${id}`);
        if (id === 'P1') {
          await fire(page, 1450, -1450);
          await waitFor(page, d => d.currentPlayerId === 'P2' && d.phase === 'ACTION', `${label} next turn`, 25_000);
        }
      }
      await page.setViewport({ width: 932, height: 430, deviceScaleFactor: dpr, hasTouch: true, isMobile: true });
      const resized = await waitFor(page, d => Math.abs(d.itemState.hud.slots[0].x / d.uiScale - (932 - (safe?.right ?? 0) - 32)) < 1 &&
        Math.abs(d.moveButtons.right.x - (932 - (safe?.right ?? 0) - 32)) < 1,
        `${width} resize anchors`);
      check(`${width}: resize preserves visible slots and settings safe area`, resized.itemState.hud.slots.length === 3 &&
        resized.settings.buttons.gear.x === 110 + (safe?.left ?? 0) && resized.settings.buttons.gear.y > 80);
    } finally { await page.close(); }
  }
}

async function runLocalCases() {
  for (const [width, height, dpr] of [[844, 390, 2], [667, 320, 2], [568, 256, 3], [1920, 1080, 1]]) {
    const label = `${width}x${height} DPR${dpr}`;
    const page = await localBattle(label, width, height, dpr);
    try {
      await page.evaluate(() => {
        window.__RR_DEBUG__.prepareItems({ P1: ['heal', 'damage_boost', 'homing'] });
        window.__RR_DEBUG__.setHp('P1', 8);
      });
      await chooseSlot(page, 0, label);
      const d = await waitFor(page, (d) => d.hp.P1 === 10, `${label} heal`);
      check(`${label}: heal spends one item but permits normal fire`, d.itemState.used.P1 &&
        d.itemState.inventory.P1[0] === null && !d.hasFired);
      check(`${label}: at least 48 CSS touch targets`, d.itemState.hud.slots.every((rect) =>
        rect.width / d.uiScale >= 48 && rect.height / d.uiScale >= 48));
      await screenshot(page, `${width}x${height}`);
      const bluePanel = d.itemState.hud.bag ?? d.itemState.hud.slots[0];
      check(`${label}: blue inventory on left`, bluePanel.x / d.uiScale < width / 2);
      const middleY = d.itemState.hud.bag?.y ?? d.itemState.hud.slots[1].y;
      check(`${label}: three slots stay visible at the team edge`, !d.itemState.hud.collapsed &&
        d.itemState.hud.slots.length === 3 && Math.abs(bluePanel.x / d.uiScale - (height <= 600 ? 32 : 34)) < 1);
      if (height <= 600) check(`${label}: phone inventory is a compact row`,
        d.itemState.hud.slots.every(slot => slot.y === middleY && slot.width / d.uiScale === 48));
      const position = (state) => JSON.stringify([state.itemState.hud.bag,
        state.itemState.hud.slots.map(({ x, y, width, height }) => ({ x, y, width, height }))]);
      const before = position(d);
      if (d.moveButtons) {
        check(`${label}: smaller arrows retain 48 CSS touch targets`,
          d.moveButtonSizes.visual / d.uiScale <= 52 && d.moveButtonSizes.hit / d.uiScale >= 48);
        await pMove(page, d.moveButtons.right);
      } else {
        await page.keyboard.down('ArrowRight'); await pause(250); await page.keyboard.up('ArrowRight');
      }
      check(`${label}: moving does not displace inventory`, position(await debug(page)) === before);
    } finally { await page.close(); }
  }

  for (const type of ['damage_boost', 'range_boost', 'homing']) {
    const page = await localBattle(type);
    try {
      await page.evaluate((type) => window.__RR_DEBUG__.prepareItems({ P1: [type] }), type);
      await chooseSlot(page, 0, type);
      check(`${type}: reservation does not consume`, (await debug(page)).itemState.inventory.P1[0] !== null);
      await fire(page, 1450, -1450);
      let d = await debug(page);
      check(`${type}: consumed atomically on fire`, d.itemState.shot.itemType === type &&
        d.itemState.used.P1 && d.itemState.inventory.P1[0] === null);
      if (type === 'homing') {
        d = await waitFor(page, (d) => d.itemState.shot?.homingActivated, 'homing activation');
        const shell = d.itemState.projectiles.find((projectile) => projectile.status === 'flying');
        check('homing: speed 4200 after 0.8s', shell && Math.abs(Math.hypot(shell.velocityX, shell.velocityY) - 4200) < 0.01);
        check('homing: simulation time boundary', shell.ageMs >= 800 - 1e-6);
        const audio = await homingAudio(page);
        check('homing: one audible four-beep loop starts at local lock', audio.length === 1 &&
          audio[0].looping && audio[0].state === 'running' && audio[0].gain > 0 && audio[0].rms > 0.1 &&
          Math.abs(audio[0].duration - 0.44) < 0.001 && !audio[0].stopped, JSON.stringify(audio));
        await page.click('.rr-battle-settings [data-action=gear]');
        await page.click('.rr-battle-settings [data-action=sound]');
        const muted = await debug(page);
        const mutedAudio = await homingAudio(page);
        check('homing: mute stops the guide while the missile is still flying',
          !muted.settings.soundEnabled && muted.phase === 'PROJECTILE' &&
          muted.itemState.projectiles.some((p) => p.status === 'flying') &&
          mutedAudio.length === 1 && mutedAudio[0].stopped);
      }
      d = await waitFor(page, (d) => d.turnId === 2 && d.phase === 'ACTION', `${type} resolve`);
      check(`${type}: actual enemy HP`, d.hp.P2 === (type === 'damage_boost' ? 7 : 8), `HP=${d.hp.P2}`);
      const redPanel = d.itemState.hud.bag ?? d.itemState.hud.slots[0];
      check(`${type}: red inventory on right`, redPanel.x / d.uiScale > page.viewport().width / 2);
      const audio = await homingAudio(page);
      check(`${type}: no guide survives impact and other items remain silent`,
        type === 'homing' ? audio.length === 1 && audio.every((entry) => entry.stopped) : audio.length === 0);
      if (type === 'homing') {
        await page.click('.rr-battle-settings [data-action=sound]');
        check('homing: sound enabled after impact cannot restart an old guide',
          (await debug(page)).settings.soundEnabled &&
          (await homingAudio(page)).length === 1 && (await homingAudio(page)).every((entry) => entry.stopped));
        await page.click('.rr-battle-settings [data-action=resume]');
      }
    } finally { await page.close(); }
  }

  const page = await localBattle('continuous pickups');
  try {
    await preparePickupCrates(page);
    await pause(420);
    await fire(page, 1400, -1200);
    const d = await waitFor(page, (d) => d.itemState.inventory.P1.filter(Boolean).length === 2, 'two continuous pickups');
    check('pickups: current flight continues', d.phase === 'PROJECTILE' && d.itemState.projectiles[0].status === 'flying');
    check('pickups: new homing does not affect current shot', d.itemState.shot.itemType === undefined && !d.itemState.shot.homingActivated);
    check('pickups: heal does not autoheal', d.hp.P1 === 10);
    await screenshot(page, 'continuous-pickup');
  } finally { await page.close(); }
}

async function runSinglePlayerControls() {
  for (const [width, height] of [[844, 390], [568, 256]]) {
    const page = await makePage(`single-player controls ${width}`, width, height, 2);
    try {
      await clickMenu(page, 'singlePlayer');
      await clickMenu(page, 'hard');
      let d = await waitFor(page, d => d.scene === 'BattleScene' && d.aimIcon.visible && d.aimIcon.hintVisible, 'human controls');
      check(`${width}: human aim and movement controls are visible`, d.moveButtonsVisible);
      await page.evaluate(() => {
        window.__RR_DEBUG__.prepareItems({ P1: ['heal', 'homing'], P2: ['damage_boost'] });
        window.__RR_AI_CONTROLS__ = [];
        window.__RR_AI_CONTROL_TIMER__ = setInterval(() => {
          const d = window.__RR_DEBUG__;
          if (d?.scene === 'BattleScene' && d.currentPlayerId === 'P2' &&
              ['ACTION', 'PROJECTILE', 'AIRSTRIKE'].includes(d.phase)) {
            window.__RR_AI_CONTROLS__.push({ phase: d.phase, visible: d.aimIcon.visible,
              hint: d.aimIcon.hintVisible, move: d.moveButtonsVisible });
          }
        }, 20);
      });
      await fire(page, 1450, -1450);
      d = await waitFor(page, d => d.currentPlayerId === 'P2' && !d.aimIcon.visible, 'AI controls hidden');
      check(`${width}: AI turn hides aim icon, halo and movement targets`, !d.aimIcon.hintVisible && !d.moveButtonsVisible);
      const panel = d.itemState.hud.bag ?? d.itemState.hud.slots[0];
      check(`${width}: human inventory stays on the blue side without an AI aim overlay`, panel && panel.x / d.uiScale < width / 2 && d.itemState.hud.playerId === 'P1');
      await screenshot(page, `single-player-ai-hidden-${width}`);
      await clickCanvas(page, d.aimButtonBounds);
      d = await debug(page);
      check(`${width}: hidden AI aim target cannot start player aiming`, !['AIMING', 'RETURN_HOME'].includes(d.cameraMode));
      d = await waitFor(page, d => d.turnId === 3 && d.currentPlayerId === 'P1' &&
        d.phase === 'ACTION' && d.aimIcon.visible && d.aimIcon.hintVisible &&
        d.moveButtonsVisible && !d.hasFired, 'AI finishes and human controls return', 25_000);
      const samples = await page.evaluate(() => { clearInterval(window.__RR_AI_CONTROL_TIMER__); return window.__RR_AI_CONTROLS__; });
      check(`${width}: whole AI action and projectile keep player controls hidden`, samples.length > 10 &&
        samples.every(frame => !frame.visible && !frame.hint && !frame.move), JSON.stringify(samples.slice(0, 4)));
      check(`${width}: human controls recover after the AI acts normally`, d.moveButtonsVisible && !d.hasFired);
      await screenshot(page, `single-player-human-restored-${width}`);
    } finally { await page.close(); }
  }
}

async function runAirstrikeCases() {
  for (const [width, height] of [[844, 390], [568, 256]]) {
    const page = await localBattle(`airstrike ${width}`, width, height, 2);
    try {
      await page.evaluate(() => window.__RR_DEBUG__.prepareItems({ P1: ['airstrike', 'heal'], P2: ['airstrike'] }));
      await chooseSlot(page, 0, 'blue airstrike');
      let d = await waitFor(page, d => d.itemState.airstrike.stage === 'flying' && !d.moveButtonsVisible && !d.aimIcon.hintVisible, 'blue plane');
      check('airstrike: instantly spends item and locks normal action', d.phase === 'AIRSTRIKE' &&
        !d.hasFired && d.turnId === 1 && d.itemState.used.P1 && !d.itemState.hud.canUse &&
        !d.moveButtonsVisible && !d.aimIcon.hintVisible, JSON.stringify(d));
      check('airstrike: blue plane flies toward red', d.itemState.airstrike.plane.flipX === false);
      await waitFor(page, d => d.itemState.airstrike.plane?.x > 1300, 'blue plane crossing');
      let flightAudio = await airstrikeAudio(page);
      check('airstrike: actual propeller buffer loops audibly during flight', flightAudio.length === 1 &&
        flightAudio[0].key === 'engine' && flightAudio[0].looping && !flightAudio[0].stopped &&
        flightAudio[0].state === 'running' && flightAudio[0].gain > 0 && flightAudio[0].rms > .01, JSON.stringify(flightAudio));
      await page.click('.rr-battle-settings [data-action=gear]');
      await page.click('.rr-battle-settings [data-action=sound]');
      check('airstrike: muting immediately stops the actual aircraft buffers',
        !(await debug(page)).settings.soundEnabled && (await airstrikeAudio(page)).every(entry => entry.stopped));
      await page.click('.rr-battle-settings [data-action=sound]');
      await page.click('.rr-battle-settings [data-action=resume]');
      flightAudio = await airstrikeAudio(page);
      check('airstrike: unmuting resumes one aircraft without overlapping the old loop',
        flightAudio.filter(entry => entry.key === 'engine').length === 2 &&
        flightAudio.filter(entry => entry.key === 'engine' && !entry.stopped).length === 1);
      await screenshot(page, `airstrike-plane-${width}`);
      d = await waitFor(page, d => d.itemState.airstrike.stage === 'dropping', 'bomb drops');
      check('airstrike: drop above enemy base follows locked target',
        Math.abs(d.itemState.airstrike.bomb.x - d.players.P2) < 1 && d.cameraMode === 'PROJECTILE_FOLLOW');
      await screenshot(page, `airstrike-bomb-${width}`);
      flightAudio = await airstrikeAudio(page);
      const drop = flightAudio.filter(entry => entry.key === 'drop');
      check('airstrike: exactly one audible falling whistle starts on release', drop.length === 1 &&
        !drop[0].looping && drop[0].gain > 0 && drop[0].rms > .01 && drop[0].state === 'running' &&
        Math.abs(drop[0].duration - .65) < .02, JSON.stringify(flightAudio));
      d = await waitFor(page, d => d.phase === 'ACTION' && !d.itemState.airstrike.busy, 'return to same turn');
      check('airstrike: damage once and resumes unspent shot in same turn', d.hp.P2 === 8 && d.turnId === 1 &&
        d.currentPlayerId === 'P1' && !d.hasFired && d.itemState.inventory.P1[0] === null && d.itemState.used.P1);
      check('airstrike: all flight and bomb sounds stop before handing back controls',
        (await airstrikeAudio(page)).every(entry => entry.stopped));
      const stable = d.hp.P2;
      await chooseSlot(page, 1, 'second item blocked');
      check('airstrike: same-turn second item cannot be used', (await debug(page)).itemState.inventory.P1[1] !== null);
      await fire(page, 1450, -1450);
      d = await waitFor(page, d => d.turnId === 2 && d.phase === 'ACTION', 'normal shot after airstrike');
      check('airstrike: ordinary shot remains available', d.hp.P2 === stable - 2);
      await clickCanvas(page, d.aimButtonBounds);
      await waitFor(page, d => d.phase === 'AIM' && d.cameraMode === 'AIMING', 'red aim before airstrike');
      await chooseSlot(page, 0, 'red airstrike from aim');
      d = await waitFor(page, d => d.itemState.airstrike.stage === 'flying', 'red plane');
      check('airstrike: red plane mirrored toward blue', d.itemState.airstrike.plane.flipX === true);
      d = await waitFor(page, d => d.phase === 'AIM' && !d.itemState.airstrike.busy && d.cameraMode === 'AIMING', 'restore original aim');
      check('airstrike: preserves red aim and remaining normal shot', d.turnId === 2 && d.currentPlayerId === 'P2' &&
        !d.hasFired && d.hp.P1 === 8);
    } finally { await page.close(); }
  }
}

async function pMove(page, point) {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  try { await pause(250); } finally { await page.mouse.up(); }
}

async function preparePickupCrates(page) {
  await page.evaluate(() => {
    const turnId = window.__RR_DEBUG__.turnId;
    window.__RR_DEBUG__.prepareItems({ P1: [], P2: [] }, [
      { id: 'qa-crate-a', type: 'heal', x: 900, y: 562, active: true, spawnTurnId: turnId, expiresAtTurnId: turnId + 6 },
      { id: 'qa-crate-b', type: 'homing', x: 1150, y: 425, active: true, spawnTurnId: turnId, expiresAtTurnId: turnId + 6 },
    ]);
  });
}

async function runOnlineCases() {
  const host = await makePage('online Host', 1280, 800, 1, false, true);
  let guest = null, foregroundTimer = null;
  try {
    await clickMenu(host, 'online');
    await waitFor(host, (d) => d.scene === 'OnlineConnectionScene', 'Host lobby');
    guest = await makePage('online Guest', 1280, 800, 1, false, true);
    await clickMenu(guest, 'online');
    await waitFor(guest, (d) => d.scene === 'OnlineConnectionScene', 'Guest lobby');
    await clickMenu(host, 'create');
    const offer = (await waitFor(host, (d) => !!d.connectionCode, 'offer')).connectionCode;
    await clickMenu(guest, 'join');
    await waitFor(guest, (d) => d.state === 'GUEST_WAITING_FOR_OFFER', 'Guest input');
    await guest.evaluate((code) => window.__RR_DEBUG__.setInputText(code), offer);
    await clickMenu(guest, 'createResponse');
    const answer = (await waitFor(guest, (d) => !!d.connectionCode, 'answer')).connectionCode;
    await host.evaluate((code) => window.__RR_DEBUG__.setInputText(code), answer);
    await clickMenu(host, 'connect');
    await waitFor(host, (d) => d.state === 'VERIFIED', 'Host verified', 30_000);
    await waitFor(guest, (d) => d.state === 'VERIFIED', 'Guest verified', 30_000);
    check('online: actual WebRTC connected', true);

    // Keep both RAF loops alive; never steal foreground during a pointer gesture.
    let tick = 0, interacting = false;
    foregroundTimer = setInterval(() => {
      if (!interacting) [host, guest][tick++ % 2].bringToFront().catch(() => {});
    }, 120);
    const interact = async (page, action) => {
      interacting = true;
      await page.bringToFront();
      try { return await action(); } finally { interacting = false; }
    };
    const onlineFire = (page, vx, vy) => interact(page, () => fire(page, vx, vy));
    const onlineSlot = (page, slot) => interact(page, () => chooseSlot(page, slot, 'online'));
    const bothAtTurn = async (turnId) => {
      for (const page of [host, guest]) await waitFor(page, (d) => d.turnId === turnId && d.phase === 'ACTION', `online turn ${turnId}`, 30_000);
    };
    const states = async () => [await debug(host), await debug(guest)];
    const onlineScreenshot = (page, name, alias) => interact(page, async () => {
      await pause(180);
      await screenshot(page, name);
      if (alias) { await page.screenshot({ path: alias }); screenshots.push(alias); }
    });
    let capturedNaturalSupply = false;
    const captureNaturalSupply = async () => {
      const d = await debug(host);
      if (capturedNaturalSupply || d.itemState.world.length === 0) return;
      await onlineScreenshot(host, 'natural-supply', '/tmp/rr-v02-items-supply.png');
      capturedNaturalSupply = true;
    };

    await clickMenu(guest, 'enterBattle');
    await clickMenu(host, 'enterBattle');
    for (const page of [host, guest]) await waitFor(page, (d) => d.scene === 'BattleScene', 'online battle');
    // First two ordinary attacks establish a real HP deficit and advance to the
    // first turn on which the production wire schema accepts spawned crates.
    await onlineFire(host, 1450, -1450);
    await bothAtTurn(2);
    let [h, g] = await states();
    check('online: ordinary attack creates the real heal deficit', h.hp.P2 === 8 && g.hp.P2 === 8);
    await onlineFire(guest, -1450, -1450);
    await bothAtTurn(3);
    await captureNaturalSupply();
    await interact(host, async () => {
      // A background tab does not advance its scene entrance clock.
      await pause(80);
      await preparePickupCrates(host);
      await pause(420);
      await waitFor(host, (d) => d.itemState.hud.canUse, 'Host crate entrance complete');
      await pause(100);
    });
    await waitFor(guest, (d) => d.itemState.world.length === 2, 'Guest crate projection');
    await onlineFire(host, 1400, -1200);
    await waitFor(guest, (d) => d.itemState.inventory.P1.filter(Boolean).length === 2, 'Guest authoritative pickups');
    [h, g] = await states();
    check('online: two pickups enter Host inventory in path order', h.itemState.inventory.P1[0]?.type === 'heal' &&
      h.itemState.inventory.P1[1]?.type === 'homing' && h.itemState.world.length === 0);
    check('online: pickups cross the DataChannel with world and inventory parity',
      JSON.stringify(h.itemState.inventory) === JSON.stringify(g.itemState.inventory) &&
      JSON.stringify(h.itemState.world) === JSON.stringify(g.itemState.world));
    check('online: pickup does not mutate the accepted ordinary shot', h.itemState.shot.itemType === undefined &&
      g.itemState.shot.itemType === undefined && !h.itemState.shot.homingActivated && !g.itemState.shot.homingActivated);
    await bothAtTurn(4);
    await captureNaturalSupply();
    [h, g] = await states();
    check('online: pickup inventory survives turn result reconciliation',
      h.itemState.inventory.P1.filter(Boolean).length === 2 &&
      JSON.stringify(h.itemState.inventory) === JSON.stringify(g.itemState.inventory) &&
      JSON.stringify(h.itemState.world) === JSON.stringify(g.itemState.world));

    // The collection shot intentionally does not hit. Healing now repairs only
    // the actual first-shot damage; no Host-only HP fixture is needed.
    await host.evaluate(() => window.__RR_DEBUG__.prepareItems({ P1: ['homing'], P2: ['heal', 'homing'] }));
    await waitFor(guest, (d) => d.itemState.inventory.P2.filter(Boolean).length === 2, 'authoritative inventory');
    await onlineSlot(guest, 0);
    await waitFor(guest, (d) => d.hp.P2 === 10 && !d.itemState.hud.pending, 'Guest heal ACK');
    [h, g] = await states();
    check('online: Guest heal authority parity', h.hp.P2 === 10 && h.itemState.inventory.P2[0] === null && g.itemState.used.P2);
    await onlineFire(guest, -1450, -1450);
    await bothAtTurn(5);
    [h, g] = await states();
    check('online: next-turn spawn and generation parity', JSON.stringify(h.itemState.world) === JSON.stringify(g.itemState.world) &&
      JSON.stringify(h.itemState.generation) === JSON.stringify(g.itemState.generation));
    await onlineSlot(host, 0);
    await onlineFire(host, 1450, -1450);
    // Observe each local simulation as it locks, rather than sampling after a delayed
    // authority message: with the higher speed the Host may already have hit by then.
    const localLocks = await Promise.all([host, guest].map((page) => waitFor(page, (d) =>
      d.itemState.projectiles.some((shell) => shell.status === 'flying' &&
        Math.abs(Math.hypot(shell.velocityX, shell.velocityY) - 4200) < 0.01), 'local 4200 guidance', 30_000)));
    check('online: both local missiles fly at 4200', localLocks.every((d) =>
      d.itemState.projectiles.some((shell) => shell.status === 'flying' && shell.ageMs >= 800 - 1e-6 &&
        Math.abs(Math.hypot(shell.velocityX, shell.velocityY) - 4200) < 0.01)));
    await waitFor(guest, (d) => d.itemState.shot?.homingActivated, 'Guest authoritative homing', 30_000);
    check('online: homing event crossed the actual DataChannel', true);
    const guidedAudio = await Promise.all([homingAudio(host), homingAudio(guest)]);
    check('online: each side starts one local guide loop without event replay',
      guidedAudio.every((audio) => audio.length === 1 && audio[0].looping && audio[0].gain > 0));
    await bothAtTurn(6);
    [h, g] = await states();
    check('online: consumed inventory and HP parity', JSON.stringify(h.itemState.inventory) === JSON.stringify(g.itemState.inventory) &&
      JSON.stringify(h.hp) === JSON.stringify(g.hp));
    check('online: turn hash matches', h.online.lastHashMatch !== false && g.online.lastHashMatch === true);
    const stoppedAudio = await Promise.all([homingAudio(host), homingAudio(guest)]);
    check('online: both guide loops stop with no late authority restart',
      stoppedAudio.every((audio) => audio.length === 1 && audio.every((entry) => entry.stopped)));
    await host.evaluate(() => window.__RR_DEBUG__.prepareItems({ P2: ['airstrike'] }));
    await waitFor(guest, d => d.itemState.inventory.P2[0]?.type === 'airstrike', 'Guest airstrike inventory');
    const hpBeforeAirstrike = (await debug(host)).hp.P1;
    await interact(guest, async () => {
      await clickCanvas(guest, (await debug(guest)).aimButtonBounds);
      await waitFor(guest, d => d.phase === 'AIM' && d.cameraMode === 'AIMING', 'Guest aim before strike');
    });
    await onlineSlot(guest, 0);
    for (const page of [host, guest]) await waitFor(page, d => d.phase === 'AIRSTRIKE' && d.itemState.airstrike.busy, 'both plane cinematic');
    [h, g] = await states();
    check('online: Guest airstrike accepted atomically by Host', h.itemState.used.P2 && g.itemState.used.P2 &&
      h.itemState.inventory.P2[0] === null && g.itemState.inventory.P2[0] === null && h.turnId === 6 && g.turnId === 6);
    for (const page of [host, guest]) await waitFor(page, d => d.phase === 'AIM' && !d.itemState.airstrike.busy, 'both resume same airstrike turn', 30_000);
    [h, g] = await states();
    check('online: airstrike HP and pending context reconcile', h.hp.P1 === hpBeforeAirstrike - 2 &&
      JSON.stringify(h.hp) === JSON.stringify(g.hp) && !h.itemState.pendingAirstrike && !g.itemState.pendingAirstrike);
    check('online: airstrike leaves Guest ordinary fire in same turn', h.turnId === 6 && g.turnId === 6 && !h.hasFired && !g.hasFired);
    await interact(guest, async () => {
      await waitFor(guest, d => d.cameraMode === 'AIMING', 'Guest restored aim camera');
      await clickCanvas(guest, (await debug(guest)).aimButtonBounds);
      await waitFor(guest, d => d.phase === 'ACTION', 'Guest cancels restored aim');
      const beforeX = (await debug(host)).players.P2;
      await guest.keyboard.down('ArrowLeft'); await pause(200); await guest.keyboard.up('ArrowLeft');
      await waitFor(host, d => d.players.P2 < beforeX, 'Host accepts Guest movement after cancel');
      check('online: Guest can cancel restored aim and continue movement', true);
    });
    await onlineFire(guest, -1450, -1450);
    await bothAtTurn(7);
    [h, g] = await states();
    check('online: airstrike then ordinary shot hashes match', JSON.stringify(h.hp) === JSON.stringify(g.hp) && g.online.lastHashMatch === true);
    await host.evaluate(() => window.__RR_DEBUG__.prepareItems({ P1: ['airstrike'] }));
    await waitFor(guest, d => d.itemState.inventory.P1[0]?.type === 'airstrike', 'Host strike inventory projection');
    await onlineSlot(host, 0);
    await waitFor(guest, d => d.itemState.airstrike.stage === 'flying', 'Guest plane before freeze');
    await guest.evaluate(() => window.__RR_DEBUG__.pauseAirstrikeFlight());
    await waitFor(host, d => d.phase === 'ACTION' && !d.itemState.airstrike.busy, 'Host strike finishes with slow Guest', 30_000);
    check('online: delayed Guest cinematic is still pending locally', (await debug(guest)).itemState.airstrike.busy);
    await onlineFire(host, 1450, -1450);
    const canonical = await waitFor(guest, d => d.hasFired && !d.itemState.airstrike.busy, 'canonical fire replaces delayed cinematic');
    check('online: normal projectile owns camera after delayed airstrike', canonical.cameraMode === 'PROJECTILE_FOLLOW' || canonical.cameraMode === 'IMPACT');
    await bothAtTurn(8);
    [h, g] = await states();
    check('online: delayed airstrike cannot hijack following turn', !g.itemState.airstrike.busy && g.cameraMode === 'FREE_VIEW' && g.online.lastHashMatch === true);
    await onlineScreenshot(host, 'online-host');
    await onlineScreenshot(guest, 'online-guest');
  } finally {
    if (foregroundTimer !== null) clearInterval(foregroundTimer);
    await guest?.close();
    await host.close();
  }
}

function browserErrors() {
  const failures = [], ignoredFavicon = [];
  for (const record of diagnostics) {
    const faviconUrls = new Set(record.failedResponses.filter((response) => {
      const url = new URL(response.url);
      return response.status === 404 && url.origin === new URL(baseUrl).origin && url.pathname.endsWith('/favicon.ico');
    }).map((response) => response.url));
    for (const response of record.failedResponses) {
      if (faviconUrls.has(response.url)) ignoredFavicon.push({ page: record.label, ...response });
      else failures.push({ page: record.label, kind: 'response', ...response });
    }
    for (const error of record.consoleErrors) {
      // README records the pre-existing favicon 404. Exclude its load diagnostic
      // only when this same page also observed the exact URL return HTTP 404.
      if (faviconUrls.has(error.location.url) &&
          /^Failed to load resource: the server responded with a status of 404 \((?:Not Found)?\)$/.test(error.message)) {
        ignoredFavicon.push({ page: record.label, kind: 'console', ...error });
      } else failures.push({ page: record.label, kind: 'console', ...error });
    }
    failures.push(...record.pageErrors.map((message) => ({ page: record.label, kind: 'pageerror', message })),
      ...record.failedRequests.map((error) => ({ page: record.label, kind: 'requestfailed', ...error })));
  }
  return { failures, ignoredFavicon };
}

async function main() {
  let preview = null, exitCode = 0, failure = null;
  try {
    if (!browserPath) throw new Error('No system Chrome or Edge found');
    baseUrl = process.env.RR_E2E_URL ?? '';
    if (!baseUrl) {
      if (!existsSync('dist/index.html')) throw new Error('Run npm run build first');
      const port = Number(process.env.RR_E2E_PORT ?? 4342);
      baseUrl = `http://127.0.0.1:${port}/`;
      preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host',
        '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (preview.exitCode !== null) throw new Error('Preview exited; choose another RR_E2E_PORT');
        try { if ((await fetch(baseUrl)).ok) { ready = true; break; } } catch { /* starting */ }
        await pause(100);
      }
      if (!ready) throw new Error('Preview startup timeout');
    }
    browser = await puppeteer.launch({ executablePath: browserPath, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
    const spOnly = process.env.RR_E2E_ITEMS_ONLY === 'sp';
    const hudOnly = process.env.RR_E2E_ITEMS_ONLY === 'hud';
    if (!spOnly) await runHudCases();
    if (!spOnly && !hudOnly) await runLocalCases();
    if (!hudOnly) await runSinglePlayerControls();
    if (!spOnly && !hudOnly) {
      await runAirstrikeCases();
      await runOnlineCases();
    }
    const errors = browserErrors();
    for (const favicon of errors.ignoredFavicon) console.log(`Observed pre-existing favicon 404: ${JSON.stringify(favicon)}`);
    check('no game resource, runtime or console errors', errors.failures.length === 0, JSON.stringify(errors.failures));
  } catch (error) {
    exitCode = 1;
    failure = error.stack ?? String(error);
    console.error(`✘ ${failure}`);
  } finally {
    const errors = browserErrors();
    if (errors.failures.length > 0) console.error(`Browser diagnostics: ${JSON.stringify(errors.failures)}`);
    writeFileSync(resultPath, JSON.stringify({ url: baseUrl, checks: assertions.length, failed: exitCode,
      assertions, failure, ...errors, diagnostics, screenshots }, null, 2));
    await Promise.race([browser?.close().catch(() => {}), pause(5000)]);
    browser?.process()?.kill();
    preview?.kill();
  }
  console.log(`Items E2E: ${assertions.length} passed, ${exitCode} failed. Results: ${resultPath}`);
  process.exit(exitCode);
}

await main();
