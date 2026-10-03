import { statSync } from 'node:fs';

/** Observe decoded roar/explosion buffers and the real gain chain, including mute. */
export async function installRoarProbe(page) {
  const sizes = {
    roar: statSync('public/assets/sfx/octopus-death-roar.mp3').size,
    spawnRoar: statSync('public/assets/sfx/octopus-spawn-roar.wav').size,
    explosion: statSync('public/assets/sfx/explosion.mp3').size,
  };
  await page.evaluateOnNewDocument((assetSizes) => {
    const Context = window.AudioContext || window.webkitAudioContext;
    const decoded = new WeakMap();
    const connections = new WeakMap();
    window.__RR_ROAR_STARTS__ = [];
    window.__RR_SPAWN_ROAR_STARTS__ = [];
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
        const starts = tag.key === 'roar' ? window.__RR_ROAR_STARTS__ : tag.key === 'spawnRoar' ? window.__RR_SPAWN_ROAR_STARTS__ : window.__RR_EXPLOSION_STARTS__;
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

/** Inspect decoded guidance audio and Phaser's scheduled, gapless buffer-source chain. */
export async function installHomingProbe(page) {
  const size = statSync('public/assets/sfx/item-homing.wav').size;
  await page.evaluateOnNewDocument((assetSize) => {
    const Context = window.AudioContext || window.webkitAudioContext;
    const decoded = new WeakMap(), connections = new WeakMap();
    const groups = new WeakMap(), sources = new WeakMap();
    window.__RR_HOMING_AUDIO__ = [];
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (...args) {
      connections.set(this, args[0]);
      return connect.apply(this, args);
    };
    const decode = Context.prototype.decodeAudioData;
    Context.prototype.decodeAudioData = function (data, success, failure) {
      const matches = data.byteLength === assetSize;
      const mark = (buffer) => {
        if (matches && !decoded.has(buffer)) {
          const samples = buffer.getChannelData(0);
          let sum = 0;
          for (const sample of samples) sum += sample * sample;
          decoded.set(buffer, Math.sqrt(sum / samples.length));
        }
        return buffer;
      };
      return decode.call(this, data, success ? (buffer) => success(mark(buffer)) : undefined, failure)?.then(mark);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer && decoded.has(this.buffer)) {
        // Phaser schedules two non-looping native buffers through the same mute node,
        // then replenishes them each cycle. Distinct mute nodes mean duplicate sounds.
        const output = connections.get(this) ?? this;
        let entry = groups.get(output);
        if (!entry) {
          let node = this, gain = 1;
          for (let i = 0; node && i < 10; i++, node = connections.get(node)) {
            if (node.gain) gain *= node.gain.value;
          }
          entry = { at: performance.now(), state: this.context.state, rms: decoded.get(this.buffer),
            gain, duration: this.buffer.duration, sources: [] };
          groups.set(output, entry);
          window.__RR_HOMING_AUDIO__.push(entry);
        }
        const part = { when: args[0] ?? 0, stoppedAt: null, endedAt: null };
        entry.sources.push(part);
        sources.set(this, part);
        this.addEventListener('ended', () => { part.endedAt = performance.now(); }, { once: true });
      }
      return start.apply(this, args);
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (...args) {
      const part = sources.get(this);
      if (part) part.stoppedAt = performance.now();
      return stop.apply(this, args);
    };
  }, size);
}

export function homingAudio(page) {
  return page.evaluate(() => (window.__RR_HOMING_AUDIO__ ?? []).map((entry) => ({ ...entry,
    looping: entry.sources.length >= 2 && Math.abs(Math.abs(entry.sources[1].when - entry.sources[0].when) - entry.duration) < 0.005,
    stopped: entry.sources.every((source) => source.stoppedAt !== null || source.endedAt !== null) })));
}

export async function installAirstrikeProbe(page) {
  const sizes = { engine: statSync('public/assets/sfx/airstrike-engine.wav').size, drop: statSync('public/assets/sfx/airstrike-drop.wav').size };
  await page.evaluateOnNewDocument((assetSizes) => {
    const Context = window.AudioContext || window.webkitAudioContext;
    const decoded = new WeakMap(), connections = new WeakMap();
    const groups = new WeakMap(), sources = new WeakMap();
    window.__RR_AIRSTRIKE_AUDIO__ = [];
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (...args) {
      connections.set(this, args[0]);
      return connect.apply(this, args);
    };
    const decode = Context.prototype.decodeAudioData;
    Context.prototype.decodeAudioData = function (data, success, failure) {
      const key = Object.keys(assetSizes).find(name => data.byteLength === assetSizes[name]);
      const mark = (buffer) => {
        if (key && !decoded.has(buffer)) {
          const samples = buffer.getChannelData(0);
          let sum = 0;
          for (const sample of samples) sum += sample * sample;
          decoded.set(buffer, { key, rms: Math.sqrt(sum / samples.length) });
        }
        return buffer;
      };
      return decode.call(this, data, success ? (buffer) => success(mark(buffer)) : undefined, failure)?.then(mark);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer && decoded.has(this.buffer)) {
        // Phaser schedules two non-looping native buffers through the same mute node,
        // then replenishes them each cycle. Distinct mute nodes mean duplicate sounds.
        const output = connections.get(this) ?? this;
        let entry = groups.get(output);
        if (!entry) {
          let node = this, gain = 1;
          for (let i = 0; node && i < 10; i++, node = connections.get(node)) {
            if (node.gain) gain *= node.gain.value;
          }
          entry = { at: performance.now(), state: this.context.state, ...decoded.get(this.buffer),
            gain, duration: this.buffer.duration, sources: [] };
          groups.set(output, entry);
          window.__RR_AIRSTRIKE_AUDIO__.push(entry);
        }
        const part = { when: args[0] ?? 0, stoppedAt: null, endedAt: null };
        entry.sources.push(part);
        sources.set(this, part);
        this.addEventListener('ended', () => { part.endedAt = performance.now(); }, { once: true });
      }
      return start.apply(this, args);
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (...args) {
      const part = sources.get(this);
      if (part) part.stoppedAt = performance.now();
      return stop.apply(this, args);
    };
  }, sizes);
}

export function airstrikeAudio(page) {
  return page.evaluate(() => (window.__RR_AIRSTRIKE_AUDIO__ ?? []).map(entry => ({ ...entry,
    looping: entry.sources.length >= 2,
    stopped: entry.sources.every(source => source.stoppedAt !== null || source.endedAt !== null) })));
}
