import Phaser from 'phaser';
import { MenuArtwork } from '../ui/MenuArtwork';
import { DEBUG_GAME } from '../config/DebugConfig';
import { ART } from '../config/ArtAssets';
import type { AIDifficulty } from '../config/GameConfig';
import { createMatchSetup } from '../match/MatchFactory';
import type { MatchSetup } from '../match/MatchSetup';
import { ViewportService } from '../platform/ViewportService';
import { InputRouter } from '../input/InputRouter';
import { getUserSettings, toggleSound } from '../settings/UserSettings';
import { MenuButton, type ButtonRect } from '../ui/MenuButton';
import { BattleScene } from './BattleScene';
import { OnlineConnectionScene } from './OnlineConnectionScene';
import { finishStartupLoadingAfterRender, isStartupLoadingVisible } from '../ui/StartupLoadingScreen';

const TITLE_FONT = 44;
const MODE_GAP = 10;
const MODE_TOP_FRACTION = 0.46;
const EDGE_MARGIN = 24;
const ICON_SIZE = 48;
const MODE_BUTTON_WIDTH = 244;
const MODE_BUTTON_HEIGHT = 52;

/**
 * 主菜单（Phase 11）：正式游戏入口。
 *
 * 职责：模式选择 → 构造 MatchSetup → scene.start(BattleScene, { setup })。
 * BattleScene 只消费 MatchSetup（禁止 URL / 全局变量猜模式）；
 * Gameplay Systems 不感知模式 —— 模式差异只决定 InputSource 组合。
 *
 * 平台（CODELY.md §25）：屏幕空间布局（相机 zoom 1，物理像素坐标），
 * uiScale 控制尺寸手感，Safe Area 避让刘海 / 圆角 / 手势条；
 * 模式按钮高 52 CSS px，工具图标 48 CSS px，触屏靠 pressed 状态、不依赖 hover。
 * 竖屏：菜单允许显示；OrientationGate 仅在战斗场景拦截。
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
  private difficultyButtons!: Record<AIDifficulty, MenuButton>;
  private difficultyBackButton!: MenuButton;
  private difficultyTitle!: Phaser.GameObjects.Text;
  private difficultyHint!: Phaser.GameObjects.Text;
  private choosingDifficulty = false;
  private fullscreenButton: MenuButton | null = null;
  private transitioning = false;

  constructor() {
    super(MainMenuScene.KEY);
  }

  create(): void {
    // scene.start 复用 Scene 实例：转场守卫必须在这里复位
    this.transitioning = false;
    this.choosingDifficulty = false;
    this.fullscreenButton = null;
    this.viewport = new ViewportService(this, { worldCameraZoom: false });
    // 菜单按钮命中走 InputRouter zone（与 Battle HUD 同管线；
    // Phaser GameObject interactive 在本项目 Scale 配置下指针坐标失效）
    this.inputRouter = new InputRouter(this);
    // The startup illustration hands directly to a painted menu, avoiding a black fade frame.
    if (!isStartupLoadingVisible()) this.cameras.main.fadeIn(220, 0, 0, 0);
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
        baseWidth: MODE_BUTTON_WIDTH,
        baseHeight: MODE_BUTTON_HEIGHT,
        fontSize: 18,
        onTap: () => this.showDifficultySelection(true),
      }),
      local2p: new MenuButton(this, {
        router: this.inputRouter,
        id: 'menu-local-2p',
        viewport: this.viewport,
        label: 'LOCAL 2 PLAYER',
        baseWidth: MODE_BUTTON_WIDTH,
        baseHeight: MODE_BUTTON_HEIGHT,
        fontSize: 18,
        onTap: () => this.startBattle(createMatchSetup('local_2p')),
      }),
      online: new MenuButton(this, {
        router: this.inputRouter,
        id: 'menu-online',
        skin: 'harbor',
        harborIcon: 'network',
        viewport: this.viewport,
        label: 'ONLINE',
        baseWidth: MODE_BUTTON_WIDTH,
        baseHeight: MODE_BUTTON_HEIGHT,
        fontSize: 18,
        accent: 0x8fa3c7,
        onTap: () => this.transitionTo(OnlineConnectionScene.KEY),
      }),
    };

    this.difficultyButtons = Object.fromEntries(
      (['easy', 'normal', 'hard'] as const).map((difficulty) => [
        difficulty,
        new MenuButton(this, {
          router: this.inputRouter,
          id: `menu-difficulty-${difficulty}`,
          viewport: this.viewport,
          label: { easy: 'EASY · 简单', normal: 'NORMAL · 普通', hard: 'HARD · 困难' }[difficulty],
          baseWidth: MODE_BUTTON_WIDTH,
          baseHeight: MODE_BUTTON_HEIGHT,
          fontSize: 18,
          onTap: () => this.startBattle(createMatchSetup('single_player', difficulty)),
        }),
      ])
    ) as Record<AIDifficulty, MenuButton>;
    this.difficultyBackButton = new MenuButton(this, {
      router: this.inputRouter,
      id: 'menu-difficulty-back',
      viewport: this.viewport,
      label: 'BACK',
      skin: 'harbor',
      harborIcon: 'back',
      baseWidth: 112,
      baseHeight: ICON_SIZE,
      fontSize: 16,
      onTap: () => this.showDifficultySelection(false),
    });
    this.difficultyTitle = this.add.text(0, 0, '选择难度', {
      fontFamily: 'Arial, sans-serif', fontStyle: 'bold', color: '#ffca59',
      stroke: '#151c22', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(900);
    this.difficultyHint = this.add.text(0, 0, '简单：轻松练习   普通：精准交锋\n困难：更精准、更有压迫感的炮击', {
      fontFamily: 'Arial, sans-serif', color: '#e8eef7',
      stroke: '#151c22', strokeThickness: 3, align: 'center',
    }).setOrigin(0.5).setDepth(900);

    this.soundButton = new MenuButton(this, {
      router: this.inputRouter,
      id: 'menu-sound',
      viewport: this.viewport,
      label: this.soundLabel(),
      baseWidth: ICON_SIZE,
      baseHeight: ICON_SIZE,
      icon: 'sound',
      accent: 0x56698a,
      onTap: () => {
        toggleSound();
        this.soundButton.setLabel(this.soundLabel());
        this.soundButton.setIconActive(getUserSettings().soundEnabled);
      },
    });

    this.soundButton.setIconActive(getUserSettings().soundEnabled);

    if (document.fullscreenEnabled) {
      this.fullscreenButton = new MenuButton(this, {
        router: this.inputRouter,
        id: 'menu-fullscreen',
        viewport: this.viewport,
        label: this.fullscreenLabel(),
        baseWidth: ICON_SIZE,
        baseHeight: ICON_SIZE,
        icon: 'fullscreen',
        accent: 0x56698a,
        onTap: () => {
          void this.toggleFullscreen();
        },
      });
    }

    document.addEventListener('fullscreenchange', this.syncFullscreenIcon);
    this.syncFullscreenIcon();
    this.showDifficultySelection(false);
    this.viewport.onChange(() => this.reposition());
    this.installDebugHandles();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
    finishStartupLoadingAfterRender(this);
  }

  // ---- 动作 --------------------------------------------------------------

  private showDifficultySelection(visible: boolean): void {
    if (this.transitioning) return;
    this.choosingDifficulty = visible;
    this.title.setVisible(!visible);
    for (const button of Object.values(this.modeButtons)) button.setVisible(!visible);
    for (const button of Object.values(this.difficultyButtons)) button.setVisible(visible);
    this.difficultyBackButton.setVisible(visible);
    this.difficultyTitle.setVisible(visible);
    this.difficultyHint.setVisible(visible);
    this.reposition();
  }

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

  private readonly syncFullscreenIcon = (): void => {
    this.fullscreenButton?.setLabel(this.fullscreenLabel());
    this.fullscreenButton?.setIconActive(Boolean(document.fullscreenElement));
  };

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
      // Logo：宽 ≤ 视口 64%，等比；窄屏再随宽收
      const short = height / uiScale < 540;
      const logoCssWidth = Math.min(short ? 340 : 680, (width / uiScale) * 0.64);
      const source = this.textures.get(ART.logo).getSourceImage();
      this.title
        .setDisplaySize(logoCssWidth * uiScale, (logoCssWidth * source.height / source.width) * uiScale)
        .setOrigin(0.5, 0).setPosition(width / 2, safeArea.top + 12 * uiScale);
    } else {
      this.title.setFontSize(Math.min(TITLE_FONT, width / uiScale / 14) * uiScale);
      this.title.setPosition(width / 2, titleY);
    }

    const gap = MODE_GAP * uiScale;
    const buttonH = MODE_BUTTON_HEIGHT * uiScale;
    const preferredTop = height / uiScale < 540
      ? safeArea.top + Math.max(160, height / uiScale * 0.43) * uiScale
      : height * MODE_TOP_FRACTION + safeArea.top;
    const top = Math.min(preferredTop, height - safeArea.bottom - 14 * uiScale - 2 * (buttonH + gap) - buttonH / 2);
    const list = [
      this.modeButtons.singlePlayer,
      this.modeButtons.local2p,
      this.modeButtons.online,
    ];
    for (let i = 0; i < list.length; i++) {
      list[i]?.setPosition(width / 2, top + (buttonH + gap) * i);
    }
    const difficultyList = [this.difficultyButtons.easy, this.difficultyButtons.normal, this.difficultyButtons.hard];
    const availableWidth = (width - safeArea.left - safeArea.right) / uiScale;
    for (let i = 0; i < difficultyList.length; i++) {
      difficultyList[i]?.setBaseWidth(Math.min(MODE_BUTTON_WIDTH, availableWidth - 32));
      difficultyList[i]?.setPosition(width / 2, top + (buttonH + gap) * i);
    }
    this.difficultyBackButton.setPosition(safeArea.left + 70 * uiScale, safeArea.top + 38 * uiScale);
    const compactHeader = top - safeArea.top < 140 * uiScale;
    this.difficultyTitle.setFontSize((compactHeader ? 24 : 30) * uiScale);
    const headerY = compactHeader
      ? Math.min(safeArea.top + 38 * uiScale, top - buttonH / 2 - this.difficultyTitle.height / 2 - 8 * uiScale)
      : top - 100 * uiScale;
    this.difficultyTitle.setPosition(width / 2, headerY)
      .setVisible(this.choosingDifficulty && headerY - this.difficultyTitle.height / 2 >= safeArea.top);
    this.difficultyHint.setFontSize(Math.min(15, (availableWidth - 32) / 22) * uiScale)
      .setPosition(width / 2, top - 54 * uiScale)
      .setVisible(this.choosingDifficulty && !compactHeader);

    const bottom = height - safeArea.bottom - 14 * uiScale - ICON_SIZE * uiScale / 2;
    const right = width - safeArea.right - 14 * uiScale - ICON_SIZE * uiScale / 2;
    this.fullscreenButton?.setPosition(right, bottom);
    this.soundButton.setPosition(right - (this.fullscreenButton ? ICON_SIZE + 10 : 0) * uiScale, bottom);
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
      get menuPage(): string {
        return self.choosingDifficulty ? 'difficulty' : 'modes';
      },
      get textRects(): Record<string, ButtonRect> {
        if (!self.choosingDifficulty) return {};
        const ui = self.viewport.current.uiScale;
        const rects: Record<string, ButtonRect> = {};
        for (const [key, text] of Object.entries({ title: self.difficultyTitle, hint: self.difficultyHint })) {
          if (!text.visible) continue;
          const r = text.getBounds();
          rects[key] = { x: (r.x + r.width / 2) / ui, y: (r.y + r.height / 2) / ui,
            width: r.width / ui, height: r.height / ui };
        }
        return rects;
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
        const rects: Record<string, ButtonRect> = self.choosingDifficulty
          ? {
              easy: toCss(self.difficultyButtons.easy),
              normal: toCss(self.difficultyButtons.normal),
              hard: toCss(self.difficultyButtons.hard),
              back: toCss(self.difficultyBackButton),
            }
          : {
              singlePlayer: toCss(self.modeButtons.singlePlayer),
              local2p: toCss(self.modeButtons.local2p),
              online: toCss(self.modeButtons.online),
            };
        rects.sound = toCss(self.soundButton);
        if (self.fullscreenButton) {
          rects.fullscreen = toCss(self.fullscreenButton);
        }
        return rects;
      },
    };
  }

  private onShutdown(): void {
    document.removeEventListener('fullscreenchange', this.syncFullscreenIcon);
    this.viewport.destroy();
    this.inputRouter.destroy();
  }
}
