/** Phase 17 animation acceptance: real movement, staged HP for effect transitions.
 * Run after npm run build: node scripts/animation-acceptance.mjs
 * Screenshots: scripts/art-acceptance-output (ignored).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const OUT_DIR = 'scripts/art-acceptance-output/animation';
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
  page.on('console', msg => {
    if(msg.type()==='warn' && /not supported in WebGL/.test(msg.text())) errors.push(msg.text());
  });
  const W = mobile ? 844 : 1280, H = mobile ? 390 : 800;
  const prefix = mobile ? 'mobile' : 'desktop';
  await page.setViewport({width:W,height:H,isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1});
  await page.goto(URL, {waitUntil:'load'});
  await waitForScene(page,'MainMenuScene');
  await (mobile ? tapMenuButton : clickMenuButton)(page,'local2p');
  await waitForScene(page,'BattleScene');
  await waitFor(async()=> (await dbg(page)).phase==='ACTION',10000,'ACTION');
  const visuals = async()=> (await dbg(page)).artAnimation;
  if(mobile) await page.touchscreen.touchStart(64,326); else await page.keyboard.down('d');
  const frames = new Set();
  for(let i=0;i<8;i++) {
    await pause(80);
    const walk=(await visuals()).find(v=>v.key==='art-blue-walk');
    if(walk) frames.add(walk.frame);
    if(i===2) await page.screenshot({path:`${OUT_DIR}/${prefix}-walking.png`});
  }
  if(mobile) await page.touchscreen.touchEnd(); else await page.keyboard.up('d');
  await pause(100);
  if(frames.size<3) throw new Error(`Walk frames did not advance: ${[...frames]}`);
  if((await visuals()).some(v=>v.key==='art-blue-walk')) throw new Error('Walk did not return to idle');
  // Advance naturally to P2 so both character sheets are exercised by real input.
  const ax=mobile?W-52:W/2, ay=mobile?H/2:H-104;
  if(mobile) await page.touchscreen.tap(ax,ay); else await page.mouse.click(ax,ay);
  await waitFor(async()=> (await dbg(page)).cameraMode==='AIMING',3000,'aim');
  const d=await dbg(page);
  const origin=worldToScreen({x:d.players.P1,y:896},W,H,d);
  const end=aimDragEnd(origin,d,45,1,60);
  if(mobile) {
    await page.touchscreen.touchStart(origin.x,origin.y-35);
    await page.touchscreen.touchMove(end.x,end.y); await pause(100); await page.touchscreen.touchEnd();
  } else {
    await page.mouse.move(origin.x,origin.y-60); await page.mouse.down();
    await page.mouse.move(end.x,end.y,{steps:8}); await page.mouse.up();
  }
  await waitFor(async()=> (await dbg(page)).currentPlayerId==='P2' && (await dbg(page)).phase==='ACTION',10000,'P2 turn');
  await pause(800);
  if(mobile) await page.touchscreen.touchStart(64,326); else await page.keyboard.down('a');
  const redFrames=new Set();
  for(let i=0;i<6;i++) {
    await pause(80);
    const walk=(await visuals()).find(v=>v.key==='art-red-walk');
    if(walk) {redFrames.add(walk.frame); if(!walk.flipX) throw new Error('P2 left walk not mirrored');}
    if(i===2) await page.screenshot({path:`${OUT_DIR}/${prefix}-red-walking.png`});
  }
  if(mobile) await page.touchscreen.touchEnd(); else await page.keyboard.up('a');
  await pause(100);
  if(redFrames.size<3 || (await visuals()).some(v=>v.key==='art-red-walk')) throw new Error('P2 walk/stop failed');
  const pan = async(target)=> {
    for(let i=0;i<12;i++) {
      const d=await dbg(page);
      const center=d.cameraScrollX+W*d.uiScale/2;
      const dx=Math.max(-400,Math.min(400,(target-center)*d.cameraZoom/d.uiScale));
      if(Math.abs(dx)<5) break;
      if(mobile) {
        await page.touchscreen.touchStart(W/2+dx/2,120);
        await page.touchscreen.touchMove(W/2-dx/2,120);
        await page.touchscreen.touchEnd();
      } else {
        await page.mouse.move(W/2+dx/2,240); await page.mouse.down();
        await page.mouse.move(W/2-dx/2,240,{steps:5}); await page.mouse.up();
      }
      await pause(80);
    }
  };
  await pan(2500);
  await page.evaluate(()=>window.__RR_DEBUG__.setHp('P1',4));
  await waitFor(async()=> (await visuals()).some(v=>v.key==='art-octopus'),2000,'octopus spawned');
  const positions=[];
  for(let i=0;i<4;i++) {
    const v=(await visuals()).find(v=>v.key==='art-octopus');
    positions.push(v.y);
    if(v.alpha!==1 || Math.abs(v.height-750)>1) throw new Error('Octopus must rise at full size without fading');
    await page.screenshot({path:`${OUT_DIR}/${prefix}-emerge-${i}.png`});
    await pause(450);
  }
  if(positions[0]<1700 || positions.some((y,i)=>i>0 && y>positions[i-1])) throw new Error(`Invalid emergence: ${positions}`);
  const oct1=(await visuals()).find(v=>v.key==='art-octopus');
  await pause(180);
  const oct2=(await visuals()).find(v=>v.key==='art-octopus');
  if(Math.abs(oct2.y-1040)>1 || oct1.frame===oct2.frame) throw new Error('Octopus idle loop not playing at surface');
  await pan(450);
  const small=(await visuals()).filter(v=>v.key==='art-base-fire');
  if(small.length!==3 || !small.every(v=>Number(v.frame)<8)) throw new Error('Expected three small flames at HP4');
  await page.screenshot({path:`${OUT_DIR}/${prefix}-small-fire.png`});
  await page.evaluate(()=>window.__RR_DEBUG__.setHp('P1',2)); await pause(250);
  const big=(await visuals()).filter(v=>v.key==='art-base-fire');
  if(big.length!==6 || !big.some(v=>Number(v.frame)>=8) || !big.some(v=>Number(v.frame)<8)) throw new Error('Expected mixed small/large flames at HP2');
  if(new Set(big.map(v=>v.y)).size<4 || Math.max(...big.map(v=>v.height))<200) throw new Error('Fire distribution/scale regression');
  await page.screenshot({path:`${OUT_DIR}/${prefix}-large-fire.png`});
  await page.evaluate(()=>window.__RR_DEBUG__.setHp('P1',10)); await pause(100);
  if((await visuals()).some(v=>v.key==='art-base-fire')) throw new Error('Fire did not clear on state recovery');
  if(errors.length) throw new Error(errors.join('\n'));
  console.log(`${prefix}: walk blue ${frames.size}/red ${redFrames.size} frames/stop, small+large fire/distribution/recovery, upward emergence ${positions.map(Math.round)}/idle passed`);
  await page.close();
}
async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  PORT = 4338; URL = `http://127.0.0.1:${PORT}/`;
  await startPreview();
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  try { await inspect(browser, false); await inspect(browser, true); }
  finally { await browser.close(); server?.kill('SIGTERM'); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
