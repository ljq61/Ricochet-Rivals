import { statSync } from 'node:fs';

/** Tag the actual decoded roar buffer, then observe Web Audio starts (including mute). */
export async function installRoarProbe(page) {
  const bytes = statSync('public/assets/sfx/octopus-death.mp3').size;
  await page.evaluateOnNewDocument((roarBytes) => {
    const Context = window.AudioContext || window.webkitAudioContext;
    const decoded = new WeakSet();
    window.__RR_ROAR_STARTS__ = [];
    const decode = Context.prototype.decodeAudioData;
    Context.prototype.decodeAudioData = function (data, success, failure) {
      const isRoar = data.byteLength === roarBytes;
      const mark = (buffer) => { if (isRoar) decoded.add(buffer); return buffer; };
      const result = decode.call(this, data, success ? (buffer) => success(mark(buffer)) : undefined, failure);
      return result?.then(mark);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer && decoded.has(this.buffer)) {
        window.__RR_ROAR_STARTS__.push({ at: performance.now(), state: this.context.state,
          duration: this.buffer.duration, length: this.buffer.length });
      }
      return start.apply(this, args);
    };
  }, bytes);
}

export function roarStarts(page) {
  return page.evaluate(() => window.__RR_ROAR_STARTS__);
}
