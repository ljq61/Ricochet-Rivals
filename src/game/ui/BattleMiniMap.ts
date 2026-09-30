import Phaser from 'phaser';
import { playerColor } from '../config/Palette';
import type { ViewportService } from '../platform/ViewportService';
import type { PlayerState } from '../state/PlayerState';
import type { PlayerId } from '../state/ids';
import { miniMapSnapshot, type MiniMapSnapshot } from './miniMapMath';

/** Read-only world overview; no interactive zone or network state of its own. */
export class BattleMiniMap {
  private readonly container: Phaser.GameObjects.Container;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private snapshot: MiniMapSnapshot | null = null;

  constructor(scene: Phaser.Scene, private readonly viewport: ViewportService) {
    this.graphics = scene.add.graphics();
    this.container = scene.add.container(0, 0, [this.graphics]).setScrollFactor(0).setDepth(950);
  }

  get debugState(): MiniMapSnapshot | null {
    if (!this.snapshot) return null;
    const s = this.snapshot;
    return { ...s, rect: { ...s.rect }, bases: { P1: { ...s.bases.P1 }, P2: { ...s.bases.P2 } },
      players: { P1: { ...s.players.P1 }, P2: { ...s.players.P2 } } };
  }

  refresh(players: Record<PlayerId, PlayerState>, currentPlayerId: PlayerId): void {
    const viewport = this.viewport.current;
    const s = miniMapSnapshot(viewport, players, currentPlayerId);
    this.snapshot = s;
    const { width, height, zoom, uiScale: ui } = viewport;
    const map = s.rect;
    this.container.setScale(1 / zoom).setPosition(
      width / 2 + (map.x - width / 2) / zoom,
      height / 2 + (map.y - height / 2) / zoom,
    );
    const g = this.graphics.clear();
    g.fillStyle(0x101b28, 0.88).fillRoundedRect(-map.width / 2, -map.height / 2, map.width, map.height, 4 * ui);
    g.lineStyle(ui, 0xb59965, 0.9).strokeRoundedRect(-map.width / 2, -map.height / 2, map.width, map.height, 4 * ui);
    g.lineStyle(2 * ui, 0x5f9dac, 0.7).lineBetween(-map.width / 2 + 8 * ui, 8 * ui, map.width / 2 - 8 * ui, 8 * ui);
    for (const id of ['P1', 'P2'] as const) {
      const b = s.bases[id];
      const p = s.players[id];
      const accent = playerColor(id);
      const baseX = (b.left + b.right) / 2 - map.x;
      const baseWidth = Math.max(4 * ui, b.right - b.left);
      g.fillStyle(accent, 0.65).fillRect(b.left - map.x, 5 * ui, baseWidth, 6 * ui);
      // A small roof and platform distinguish the stationary base from the moving crew dot.
      g.fillStyle(accent, 0.85).fillRect(baseX - 2 * ui, ui, 4 * ui, 5 * ui);
      g.fillTriangle(baseX - 3 * ui, ui, baseX, -2 * ui, baseX + 3 * ui, ui);
      const x = p.x - map.x;
      const y = p.y - map.y;
      if (p.current) g.lineStyle(1.5 * ui, 0xffdf9e).strokeCircle(x, y, 5 * ui);
      g.fillStyle(p.alive ? accent : 0x737a83).fillCircle(x, y, 3 * ui);
      g.lineStyle(ui, 0xf3efdb).lineBetween(x, y + 3 * ui, x, y + 6 * ui);
    }
  }

  destroy(): void { this.container.destroy(); }
}
