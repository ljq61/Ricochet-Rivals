import { detectDeviceProfile } from './DeviceProfile';

/**
 * OrientationGate — 横屏门禁（Phase 6.5：Mobile Landscape 是一等目标平台）。
 *
 * 竖屏 + 触屏设备 → 显示「请旋转设备」覆盖层。
 * 覆盖层是 DOM 元素，会挡住 Canvas：
 * - 视觉上阻止竖屏操作；
 * - InputRouter 的 pointerdown 以 event.target === canvas 为准，
 *   覆盖层显示时手势自然被拦截，无需额外耦合。
 *
 * Phase 13：门禁范围可注入 —— shouldGate() 决定当前是否需要横屏
 * （Battle 才强制；Menu / Online Connection 等连接流程允许竖屏，
 * 手机复制 / 粘贴连接码时竖屏体验更佳）。缺省恒 true = 全场景门禁
 * （Phase 6.5 原语义）。
 * 纯 DOM 层：在 main.ts 安装，不依赖 Phaser（场景未启动也生效）。
 * 桌面 profile 不弹层 —— 窗口形状不限制桌面操作。
 */

export const ROTATE_OVERLAY_ID = 'rotate-overlay';

export class OrientationGate {
  private readonly overlay: HTMLElement | null;
  private readonly isTouchDevice: boolean;
  private readonly shouldGate: () => boolean;
  private blocked = false;

  constructor(doc: Document = document, shouldGate: () => boolean = () => true) {
    this.overlay = doc.getElementById(ROTATE_OVERLAY_ID);
    this.shouldGate = shouldGate;
    this.isTouchDevice = detectDeviceProfile().controlProfile === 'touch';
    if (this.isTouchDevice) {
      window.addEventListener('resize', this.refresh);
      this.refresh();
    }
  }

  get isBlocked(): boolean {
    return this.blocked;
  }

  destroy(): void {
    if (this.isTouchDevice) {
      window.removeEventListener('resize', this.refresh);
    }
  }

  private readonly refresh = (): void => {
    if (!this.overlay) {
      return;
    }
    const portrait = window.innerHeight > window.innerWidth;
    this.blocked = this.isTouchDevice && portrait && this.shouldGate();
    this.overlay.classList.toggle('is-visible', this.blocked);
  };
}
