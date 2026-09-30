import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { TurnBanner } from '../../src/game/ui/TurnBanner';
import { computeViewportMetrics } from '../../src/game/platform/viewportMath';
import type { ViewportService } from '../../src/game/platform/ViewportService';
import { battleHudLayout } from '../../src/game/ui/miniMapMath';

vi.mock('phaser', () => ({ default: {} }));

// Model Phaser's measured text/wrapping boundary; browser acceptance verifies actual glyphs.
class MeasuredText {
  text = '';
  style = { fontSize: '26px' };
  private spacing = 0;
  private wrap = 0;
  get font() { return Number.parseFloat(this.style.fontSize); }
  get width() { return Math.max(...this.getWrappedText().map((line) => line.length * this.font * 0.6)); }
  get height() { return this.getWrappedText().length * (this.font + 2) + (this.getWrappedText().length - 1) * this.spacing; }
  setFontSize(size: number) { this.style.fontSize = `${size}px`; return this; }
  setText(text: string) { this.text = text; return this; }
  setWordWrapWidth(width: number) { this.wrap = width; return this; }
  setLineSpacing(spacing: number) { this.spacing = spacing; return this; }
  setOrigin() { return this; }
  setColor() { return this; }
  getWrappedText(): string[] {
    const limit = this.wrap > 0 ? Math.max(1, Math.floor(this.wrap / (this.font * 0.6))) : Infinity;
    return this.text.split('\n').flatMap((line) => {
      if (limit === Infinity || line.length === 0) return [line];
      const rows: string[] = [];
      for (let i = 0; i < line.length; i += limit) rows.push(line.slice(i, i + limit));
      return rows;
    });
  }
}

function setup(width: number, height: number) {
  const text = new MeasuredText();
  const graphic = new Proxy({}, { get: () => () => graphic });
  const container = new Proxy({ visible: false }, { get: (obj, key) => key === 'visible' ? obj.visible : () => container });
  const scene = { add: { graphics: () => graphic, text: () => text, container: () => container },
    tweens: { add: () => ({ stop() {} }) } } as unknown as Phaser.Scene;
  const listeners: Array<() => void> = [];
  const viewport = {
    current: computeViewportMetrics(width, height, { top: 8, bottom: 20, left: 4, right: 4 }),
    onChange: (callback: () => void) => { listeners.push(callback); return () => {}; },
  };
  const banner = new TurnBanner(scene, viewport as unknown as ViewportService, (v) => battleHudLayout(v).banner);
  return { banner, text, viewport, resize: (w: number, h: number) => {
    viewport.current = computeViewportMetrics(w, h, { top: 8, bottom: 20, left: 4, right: 4 });
    listeners.forEach((cb) => cb());
  } };
}

describe('TurnBanner compact messages', () => {
  it.each([320, 480, 600, 844])('wraps readable turn/connection messages at %ipx × 180px', (width) => {
    const { banner, text, viewport } = setup(width, 180);
    const messages = ["OPPONENT'S TURN · 第 999 回合", 'OPPONENT DISCONNECTED', 'CONNECTION SYNC FAILED',
      'ACTION REJECTED — LATE COMMAND FOR PREVIOUS TURN'];
    for (const message of messages) {
      banner.showMessage(message, 0xff5063);
      const layout = banner.layoutState;
      expect(layout.fontSize).toBeGreaterThanOrEqual(10);
      expect(layout.rect.width).toBeLessThanOrEqual(battleHudLayout(viewport.current).banner.width + 3.01);
      expect(text.height).toBeLessThanOrEqual(layout.rect.height);
      expect(banner.text).toBe(message);
      expect(banner.lastBannerText).toBe(message);
      expect(layout.text.length).toBeGreaterThan(0);
    }
    banner.showTurn('P2', 123);
    expect(banner.layoutState.fontSize).toBeGreaterThanOrEqual(10);
    expect(banner.text).toBe('P2 · 第 123 回合');
  });

  it('restores the full message and normal font after rotating out of a short viewport', () => {
    const { banner, resize } = setup(320, 180);
    const message = 'ACTION REJECTED — LATE COMMAND FOR PREVIOUS TURN';
    banner.showMessage(message, 0xff5063);
    resize(844, 390);
    expect(banner.text).toBe(message);
    expect(banner.layoutState.fontSize).toBeGreaterThanOrEqual(10);
    expect(banner.layoutState.text).toBe(message);
    expect(banner.layoutState.rect.height).toBe(55);
  });
});
