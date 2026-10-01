import { statSync } from 'node:fs';

/** Observe decoded roar/explosion buffers and the real gain chain, including mute. */
export async function installRoarProbe(page) {
  const sizes = {
    roar: statSync('public/assets/sfx/octopus-death-roar.mp3').size,
    explosion: statSync('public/assets/sfx/explosion.mp3').size,
  };
  await page.evaluateOnNewDocument((assetSizes) => {
    const Context = window.AudioContext || window.webkitAudioContext;
    const decoded = new WeakMap();
    const connections = new WeakMap();
    window.__RR_ROAR_STARTS__ = [];
    window.__RR_EXPLOSION_STARTS__ = [];
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (...args) {
      connections.set(this, args[0]);
      return connect.apply(this, args);
    };
    const decode = Context.prototype.decodeAudioData;
    Context.prototype.decodeAudioData = function (data, success, failure) {
      const key = Object.keys(assetSizes).find((name) => data.byteLength === assetSizes[name]);
      const mark = (buffer) => {
        if (key && !decoded.has(buffer)) {
          const samples = buffer.getChannelData(0);
          let sum = 0;
          for (const sample of samples) sum += sample * sample;
          decoded.set(buffer, { key, rms: Math.sqrt(sum / samples.length) });
        }
        return buffer;
      };
      const result = decode.call(this, data, success ? (buffer) => success(mark(buffer)) : undefined, failure);
      return result?.then(mark);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      const tag = this.buffer && decoded.get(this.buffer);
      if (tag) {
        let node = this, gain = 1;
        for (let i = 0; node && i < 10; i++, node = connections.get(node)) {
          if (node.gain) gain *= node.gain.value;
        }
        const starts = tag.key === 'roar' ? window.__RR_ROAR_STARTS__ : window.__RR_EXPLOSION_STARTS__;
        starts.push({ at: performance.now(), state: this.context.state, rms: tag.rms, gain,
          duration: this.buffer.duration, length: this.buffer.length });
      }
      return start.apply(this, args);
    };
  }, sizes);
}

export function roarStarts(page) {
  return page.evaluate(() => window.__RR_ROAR_STARTS__);
}

export function explosionStarts(page) {
  return page.evaluate(() => window.__RR_EXPLOSION_STARTS__);
}
