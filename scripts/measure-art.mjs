#!/usr/bin/env node
/**
 * 测量美术 PNG 的不透明内容边界（alpha > 16 的 bbox）。
 *
 * 用途：运行时精灵的 scale / origin 需要内容边界（如 PLAYER_ART_BOUNDS、
 * 弹体显示尺寸）—— 本脚本把"人工目测"固化为一行命令：
 *
 *   node scripts/measure-art.mjs public/assets/art/*.png
 *
 * 零依赖：手写 PNG 解码（zlib inflate + scanline unfilter），仅支持
 * 8-bit RGBA(6) / RGB(2) —— AI 生成素材均为这两类；其他类型显式报错。
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function measurePng(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`${path}: not a PNG`);
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (bitDepth !== 8 || channels === 0) {
    throw new Error(`${path}: unsupported PNG (bitDepth=${bitDepth}, colorType=${colorType})`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[src++];
      const left = x >= channels ? out[row + x - channels] : 0;
      const up = y > 0 ? out[row - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? out[row - stride + x - channels] : 0;
      let val;
      switch (filter) {
        case 0: val = cur; break;
        case 1: val = cur + left; break;
        case 2: val = cur + up; break;
        case 3: val = cur + ((left + up) >> 1); break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          val = cur + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default:
          throw new Error(`${path}: bad filter ${filter}`);
      }
      out[row + x] = val & 0xff;
    }
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const a = channels === 4 ? out[row + x * 4 + 3] : 255;
      if (a > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    throw new Error(`${path}: fully transparent`);
  }
  return {
    path,
    width,
    height,
    left: minX,
    top: minY,
    right: maxX,
    bottom: maxY,
    contentW: maxX - minX + 1,
    contentH: maxY - minY + 1,
  };
}

for (const file of process.argv.slice(2)) {
  const b = measurePng(file);
  console.log(
    `${file}: canvas ${b.width}x${b.height} | content left=${b.left} top=${b.top} right=${b.right} bottom=${b.bottom} (${b.contentW}x${b.contentH})`
  );
}
