import Phaser from 'phaser';
import { playerColor, toCssColor } from '../config/Palette';
import { DEBUG_GAME } from '../config/DebugConfig';
import type { MatchSetup } from '../match/MatchSetup';
import { ViewportService } from '../platform/ViewportService';
import { InputRouter } from '../input/InputRouter';
import { MenuButton, type ButtonRect } from '../ui/MenuButton';
import type { PlayerId } from '../state/ids';
import { BattleScene } from './BattleScene';
import { MainMenuScene } from './MainMenuScene';

const TITLE_FONT = 46;

/** ResultScene 入参（BattleScene gameOver 转场时注入） */
export interface ResultSceneData {
  setup: MatchSetup;
  winnerId: PlayerId | null;
  /** Phase 14 联机：本地玩家 ID（YOU WIN / YOU LOSE 视角）；离线不传 */
  localPlayerId?: PlayerId;
}

/**
 * 结果场景（Phase 11 基础版；Phase 14 起支持 Online）：
 * - Single Player：YOU WIN / YOU LOSE（P1 视角）
 * - Local 2P：PLAYER 1 WINS / PLAYER 2 WINS；平局（同归于尽）→ DRAW
 * - Online（Phase 14）：本地视角 YOU WIN / YOU LOSE；无 REMATCH
 *   （Online Rematch 是 Phase 16 —— 本阶段仅 MAIN MENU，会话已随
 *   BattleScene 关闭而销毁）
 * - REMATCH：以同一 MatchSetup 重新 scene.start(BattleScene) ——
 *   create 重建全新 GameState，旧局污染（HP / 位置 / 相位 / AI / 相机）
 *   随场景重建一并清除
 */
export class ResultScene extends Phaser.Scene {
  static readonly KEY = 'ResultScene';

  private setup!: MatchSetup;
  private winnerId!: PlayerId | null;
  /** Phase 14 联机本地视角（离线 null） */
  private localPlayerId: PlayerId | null = null;
  private viewport!: ViewportService;
  private inputRouter!: InputRouter;
  private titleText!: Phaser.GameObjects.Text;
  private rematchButton: MenuButton | null = null;
  private mainMenuButton!: MenuButton;
  private transitioning = false;

  constructor() {
    super(ResultScene.KEY);
  }

  init(data: ResultSceneData): void {
    this.setup = data.setup;
    this.winnerId = data.winnerId;
    this.localPlayerId = data.localPlayerId ?? null;
  }

  create(): void {
    this.transitioning = false;
    this.viewport = new ViewportService(this, { worldCameraZoom: false });
    this.inputRouter = new InputRouter(this);
    this.cameras.main.fadeIn(220, 0, 0, 0);

    this.titleText = this.add
      .text(0, 0, this.resultLabel(), {
        fontFamily: 'monospace',
        color: this.resultColor(),
      })
      .setOrigin(0.5)
      .setDepth(900);

    if (this.setup.mode !== 'online') {
      this.rematchButton = new MenuButton(this, {
        router: this.inputRouter,
        id: 'result-rematch',
        viewport: this.viewport,
        label: 'REMATCH',
        onTap: () => this.transitionTo(BattleScene.KEY, { setup: this.setup }),
      });
    }
    this.mainMenuButton = new MenuButton(this, {
      router: this.inputRouter,
      id: 'result-main-menu',
      viewport: this.viewport,
      label: 'MAIN MENU',
      accent: 0x56698a,
      onTap: () => this.transitionTo(MainMenuScene.KEY),
    });

    this.reposition();
    this.viewport.onChange(() => this.reposition());
    this.installDebugHandles();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  private resultLabel(): string {
    if (this.winnerId === null) {
      return 'DRAW';
    }
    if (this.setup.mode === 'single_player') {
      return this.winnerId === 'P1' ? 'YOU WIN' : 'YOU LOSE';
    }
    if (this.setup.mode === 'online') {
      // Phase 14：本地视角（P1=Host / P2=Guest，经 localPlayerId 判断）
      return this.winnerId === this.localPlayerId ? 'YOU WIN' : 'YOU LOSE';
    }
    return this.winnerId === 'P1' ? 'PLAYER 1 WINS' : 'PLAYER 2 WINS';
  }

  private resultColor(): string {
    if (this.winnerId === null) {
      return '#ffd24a';
    }
    if (
      this.setup.mode === 'single_player' ||
      this.setup.mode === 'online'
    ) {
      const won =
        this.setup.mode === 'online'
          ? this.winnerId === this.localPlayerId
          : this.winnerId === 'P1';
      return won ? '#3f8cff' : '#ff5063';
    }
    return toCssColor(playerColor(this.winnerId));
  }

  private transitionTo(key: string, data?: Record<string, unknown>): void {
    if (this.transitioning) {
      return;
    }
    this.transitioning = true;
    this.cameras.main.fadeOut(220, 0, 0, 0);
    this.cameras.main.once(
      Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE,
      () => {
        this.scene.start(key, data);
      }
    );
  }

  private reposition(): void {
    const { width, height, uiScale } = this.viewport.current;

    this.titleText.setFontSize(TITLE_FONT * uiScale);
    this.titleText.setPosition(width / 2, height * 0.34);

    const buttonH = 64 * uiScale;
    const gap = MODE_GAP * uiScale;
    const baseY = height * 0.56;
    if (this.rematchButton) {
      this.rematchButton.setPosition(width / 2, baseY);
      this.mainMenuButton.setPosition(width / 2, baseY + buttonH + gap);
    } else {
      this.mainMenuButton.setPosition(width / 2, baseY);
    }
  }

  private installDebugHandles(): void {
    if (!DEBUG_GAME) {
      return;
    }
    const self = this;
    (window as unknown as Record<string, unknown>).__RR_DEBUG__ = {
      get scene(): string {
        return 'ResultScene';
      },
      get resultText(): string {
        return self.titleText.text;
      },
      get winnerId(): string | null {
        return self.winnerId;
      },
      get buttons(): Record<string, ButtonRect> {
        const ui = self.viewport.current.uiScale;
        const toCss = (button: MenuButton): ButtonRect => {
          const r = button.rect();
          return {
            x: r.x / ui,
            y: r.y / ui,
            width: r.width / ui,
            height: r.height / ui,
          };
        };
        const rects: Record<string, ButtonRect> = {
          mainMenu: toCss(self.mainMenuButton),
        };
        if (self.rematchButton) {
          rects.rematch = toCss(self.rematchButton);
        }
        return rects;
      },
    };
  }

  private onShutdown(): void {
    this.viewport.destroy();
    this.inputRouter.destroy();
  }
}

const MODE_GAP = 20;
