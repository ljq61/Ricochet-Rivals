import Phaser from 'phaser';
import { MenuArtwork } from '../ui/MenuArtwork';
import { DEBUG_GAME } from '../config/DebugConfig';
import { ART } from '../config/ArtAssets';
import { createMatchSetup } from '../match/MatchFactory';
import type { MatchSetup } from '../match/MatchSetup';
import { ViewportService } from '../platform/ViewportService';
import { InputRouter } from '../input/InputRouter';
import { getUserSettings, toggleSound } from '../settings/UserSettings';
import { MenuButton, type ButtonRect } from '../ui/MenuButton';
import { BattleScene } from './BattleScene';
import { OnlineConnectionScene } from './OnlineConnectionScene';

const TITLE_FONT = 44;
const MODE_GAP = 20;
const MODE_TOP_FRACTION = 0.32;
const EDGE_MARGIN = 24;
const SMALL_BUTTON_WIDTH = 220;

/**
 * 主菜单（Phase 11）：正式游戏入口。
 *
 * 职责：模式选择 → 构造 MatchSetup → scene.start(BattleScene, { setup })。
 * BattleScene 只消费 MatchSetup（禁止 URL / 全局变量猜模式）；
 * Gameplay Systems 不感知模式 —— 模式差异只决定 InputSource 组合。
 *
 * 平台（CODELY.md §25）：屏幕空间布局（相机 zoom 1，物理像素坐标），
 * uiScale 控制尺寸手感，Safe Area 避让刘海 / 圆角 / 手势条；
 * 按钮 hit target 64 CSS px ≥ 56 下限，触屏靠 pressed 状态、不依赖 hover。
 * 竖屏：全局 OrientationGate DOM 覆盖层自然拦截（菜单可见但被盖住）。
 *
 * Sound / Fullscreen：Sound 经 UserSettings（localStorage 持久化，失败兜底）；
 * Fullscreen feature-detect，不支持则隐藏；请求来自用户操作，
 * 失败 .catch 不影响游戏。
 */
export class MainMenuScene extends Phaser.Scene {
  static readonly KEY = 'MainMenuScene';

  private viewport!: ViewportService;
  private inputRouter!: InputRouter;
  /** 真机反馈轮：Logo 图优先；素材缺失回退文本标题 */
  private title!: Phaser.GameObjects.Image | Phaser.GameObjects.Text;
  private artwork!: MenuArtwork;
  private modeButtons!: Record<
    'singlePlayer' | 'local2p' | 'online',
    MenuButton
  >;
  private soundButton!: MenuButton;
  private fullscreenButton: MenuButton | null = null;
  private transitioning = false;

  constructor() {
    super(MainMenuScene.KEY);
  }

  create(): void {
    // scene.start 复用 Scene 实例：转场守卫必须在这里复位
    this.transitioning = false;
    this.viewport = new ViewportService(this, { worldCameraZoom: false });
    // 菜单按钮命中走 InputRouter zone（与 Battle HUD 同管线；
    // Phaser GameObject interactive 在本项目 Scale 配置下指针坐标失效）
    this.inputRouter = new InputRouter(this);
    this.cameras.main.fadeIn(220, 0, 0, 0);
    this.artwork = new MenuArtwork(this);

    // 真机反馈轮：生成 Logo（concept_UI 标题页风格）替代文字标题；
    // 素材缺失保留原 Georgia 文本（E2E 不断言菜单标题）
    if (this.textures.exists(ART.logo)) {
      this.title = this.add
        .image(0, 0, ART.logo)
        .setOrigin(0.5)
        .setDepth(900);
    } else {
      this.title = this.add
        .text(0, 0, 'RICOCHET RIVALS', {
          fontFamily: 'Georgia, serif',
          fontStyle: 'bold',
          color: '#ffca59',
          stroke: '#151c22',
          strokeThickness: 6,
        })
        .setOrigin(0.5)
        .setDepth(900);
    }

    this.modeButtons = {
      singlePlayer: new MenuButton(this, {
        router: this.inputRouter,
        id: 'menu-single-player',
        viewport: this.viewport,
        label: 'SINGLE PLAYER',
        onTap: () => this.startBattle(createMatchSetup('single_player')),
      }),
      local2p: new MenuButton(this, {
        router: this.inputRouter,
        id: 'menu-local-2p',
        viewport: this.viewport,
        label: 'LOCAL 2 PLAYER',
        onTap: () => this.startBattle(createMatchSetup('local_2p')),
      }),
      online: new MenuButton(this, {
        router: this.inputRouter,
        id: 'menu-online',
        viewport: this.viewport,
        label: 'ONLINE',
        accent: 0x8fa3c7,
        onTap: () => this.transitionTo(OnlineConnectionScene.KEY),
      }),
    };

    this.soundButton = new MenuButton(this, {
      router: this.inputRouter,
      id: 'menu-sound',
      viewport: this.viewport,
      label: this.soundLabel(),
      baseWidth: SMALL_BUTTON_WIDTH,
      accent: 0x56698a,
      onTap: () => {
        toggleSound();
        this.soundButton.setLabel(this.soundLabel());
      },
    });

    if (document.fullscreenEnabled) {
      this.fullscreenButton = new MenuButton(this, {
        router: this.inputRouter,
        id: 'menu-fullscreen',
        viewport: this.viewport,
        label: this.fullscreenLabel(),
        baseWidth: SMALL_BUTTON_WIDTH,
        accent: 0x56698a,
        onTap: () => {
          void this.toggleFullscreen();
        },
      });
    }

    this.reposition();
    this.viewport.onChange(() => this.reposition());
    this.installDebugHandles();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  // ---- 动作 --------------------------------------------------------------

  /** 模式启动：fadeOut → BattleScene(setup)（转场 150～300ms） */
  private startBattle(setup: MatchSetup): void {
    this.transitionTo(BattleScene.KEY, { setup });
  }

  /** 转场（防重复点击：第一次 fadeOut 后忽略后续） */
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

  private soundLabel(): string {
    return `SOUND: ${getUserSettings().soundEnabled ? 'ON' : 'OFF'}`;
  }

  private fullscreenLabel(): string {
    return document.fullscreenElement ? 'EXIT FULLSCREEN' : 'FULLSCREEN';
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
      this.fullscreenButton?.setLabel(this.fullscreenLabel());
    } catch {
      // 全屏失败（iframe 限制 / 权限）：不影响游戏，按钮保持原状
    }
  }

  // ---- 布局 --------------------------------------------------------------

  /** Safe Area + uiScale 布局（resize / 旋转 / DPR 变化自动重排） */
  private reposition(): void {
    const { width, height, safeArea, uiScale } = this.viewport.current;
    this.artwork.layout(width, height, uiScale);

    const titleY =
      safeArea.top + (height / uiScale < 540 ? 28 : EDGE_MARGIN + TITLE_FONT * 0.6) * uiScale;
    if (this.title instanceof Phaser.GameObjects.Image) {
      // Logo：宽 ≤ 视口 62%，等比；窄屏再随宽收
      const logoCssWidth = Math.min(560, (width / uiScale) * 0.62);
      const source = this.textures.get(ART.logo).getSourceImage();
      this.title
        .setDisplaySize(logoCssWidth * uiScale, (logoCssWidth * source.height / source.width) * uiScale)
        .setPosition(width / 2, titleY);
    } else {
      this.title.setFontSize(Math.min(TITLE_FONT, width / uiScale / 14) * uiScale);
      this.title.setPosition(width / 2, titleY);
    }

    const gap = (height / uiScale < 540 ? 0 : MODE_GAP) * uiScale;
    const buttonH = 64 * uiScale;
    const top = height / uiScale < 540
      ? safeArea.top + 108 * uiScale
      : height * MODE_TOP_FRACTION + safeArea.top;
    const list = [
      this.modeButtons.singlePlayer,
      this.modeButtons.local2p,
      this.modeButtons.online,
    ];
    for (let i = 0; i < list.length; i++) {
      list[i]?.setPosition(width / 2, top + (buttonH + gap) * i);
    }

    const bottom =
      height - safeArea.bottom - EDGE_MARGIN * uiScale - buttonH / 2;
    this.soundButton.setPosition(
      safeArea.left + EDGE_MARGIN * uiScale + (SMALL_BUTTON_WIDTH / 2) * uiScale,
      bottom
    );
    this.fullscreenButton?.setPosition(
      width -
        safeArea.right -
        EDGE_MARGIN * uiScale -
        (SMALL_BUTTON_WIDTH / 2) * uiScale,
      bottom
    );
  }

  // ---- E2E / 调试 ---------------------------------------------------------

  private installDebugHandles(): void {
    if (!DEBUG_GAME) {
      return;
    }
    const self = this;
    (window as unknown as Record<string, unknown>).__RR_DEBUG__ = {
      get scene(): string {
        return 'MainMenuScene';
      },
      get soundEnabled(): boolean {
        return getUserSettings().soundEnabled;
      },
      get buttons(): Record<string, ButtonRect> {
        // 物理 px → CSS px：E2E（puppeteer）注入坐标为 CSS 口径
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
          singlePlayer: toCss(self.modeButtons.singlePlayer),
          local2p: toCss(self.modeButtons.local2p),
          online: toCss(self.modeButtons.online),
          sound: toCss(self.soundButton),
        };
        if (self.fullscreenButton) {
          rects.fullscreen = toCss(self.fullscreenButton);
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
