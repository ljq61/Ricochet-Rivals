/**
 * Gesture 仲裁核心（Phase 6.5，CODELY.md §25，纯逻辑可单测）。
 *
 * 输入优先级：UI > AIM > MOVEMENT > CAMERA。
 * 同一个 Pointer 从 pointerdown 到 pointerup / pointercancel
 * 只能属于一个 Gesture Owner（按 DOM pointerId 追踪）。
 *
 * 两类参与方：
 * - Zone（屏幕空间命中区）：HUD 按钮 —— AimButton、TouchControls 的
 *   移动 / 聚焦按钮。屏幕实体按钮一律注册为 UI（永远先于世界手势，
 *   防止 AIM 起始半径覆盖按钮时误判）；isActive=false 时不可命中
 *   （如聚焦按钮仅在 FREE_VIEW 激活）。
 * - Claimant（世界空间仲裁方）：AIM（瞄准拖拽）、CAMERA（自由观察拖动）。
 *   tryClaim 约定：返回 false 时必须无副作用。
 * MOVEMENT 档位预留给未来的非按钮移动手势（如拖动角色）。
 *
 * Zone 与 Claimant 混合，按 GestureKind 优先级统一排序仲裁；
 * 同优先级按注册顺序。胜利者的 onDown / tryClaim 恰好触发一次。
 */

export type GestureKind = 'UI' | 'AIM' | 'MOVEMENT' | 'CAMERA';

export const GESTURE_PRIORITY: Readonly<Record<GestureKind, number>> = {
  UI: 0,
  AIM: 1,
  MOVEMENT: 2,
  CAMERA: 3,
};

/** DOM PointerEvent 的最小快照（InputRouter 负责从原生事件构造） */
export interface GesturePointerEvent {
  pointerId: number;
  /** 'mouse' | 'touch' | 'pen' */
  pointerType: string;
  /** 0 = 主键 / 触摸；非主键在 arbiter 层直接忽略 */
  button: number;
  /**
   * 画布（游戏）坐标 —— InputRouter 经 canvas.getBoundingClientRect()
   * 从 client 坐标换算，与视觉渲染同一空间。所有 zone 命中 /
   * 世界交互一律用这个：画布被浏览器缩放 / 偏移（移动端视口怪癖）
   * 时输入仍与画面一致。
   */
  x: number;
  y: number;
  /** 页面原始坐标 —— 物理手感类判定用（如瞄准死区：手指物理抖动距离） */
  clientX: number;
  clientY: number;
}

/** 屏幕空间命中区（HUD 按钮注册） */
export interface GestureZone {
  id: string;
  kind: GestureKind;
  /** false = 当前不可命中（按钮禁用 / 隐藏） */
  isActive(): boolean;
  contains(x: number, y: number): boolean;
  onDown?(event: GesturePointerEvent): void;
  onUp?(event: GesturePointerEvent): void;
  onCancel?(event: GesturePointerEvent): void;
  /** 悬停反馈（仅未占用指针的 mouse move 会被路由） */
  onHover?(inside: boolean, event: GesturePointerEvent): void;
}

/** 世界空间仲裁方（AIM / CAMERA） */
export interface GestureClaimant {
  kind: GestureKind;
  /** 无副作用探测；返回 true 即获得该 pointer 的所有权并开始手势 */
  tryClaim(event: GesturePointerEvent): boolean;
  onMove(event: GesturePointerEvent): void;
  onUp(event: GesturePointerEvent): void;
  onCancel(event: GesturePointerEvent): void;
}

interface GestureOwner {
  onMove?(event: GesturePointerEvent): void;
  onUp?(event: GesturePointerEvent): void;
  onCancel?(event: GesturePointerEvent): void;
}

interface ClaimCandidate {
  kind: GestureKind;
  order: number;
  owner: GestureOwner;
  /** 触发一次开局动作（Zone.onDown / Claimant.tryClaim），返回是否认领 */
  begin(event: GesturePointerEvent): boolean;
}

export class GestureArbiter {
  private readonly zones: GestureZone[] = [];
  private readonly claimants: GestureClaimant[] = [];
  private readonly orders = new WeakMap<object, number>();
  /** pointerId → 手势所有权（一个 Pointer 一次生命周期只归一个 Owner） */
  private readonly owners = new Map<number, GestureOwner>();
  private lastHoveredZone: GestureZone | null = null;
  private nextOrder = 0;

  registerZone(zone: GestureZone): void {
    this.orders.set(zone, this.nextOrder++);
    this.zones.push(zone);
  }

  unregisterZone(id: string): void {
    const index = this.zones.findIndex((zone) => zone.id === id);
    if (index >= 0) {
      this.zones.splice(index, 1);
    }
    if (this.lastHoveredZone?.id === id) {
      this.lastHoveredZone = null;
    }
  }

  registerClaimant(claimant: GestureClaimant): void {
    this.orders.set(claimant, this.nextOrder++);
    this.claimants.push(claimant);
  }

  /** pointerdown：按优先级仲裁所有权；无人认领则忽略该 Pointer */
  onPointerDown(event: GesturePointerEvent): void {
    if (event.button !== 0) {
      return; // 只处理主键 / 触摸
    }
    if (this.owners.has(event.pointerId)) {
      return; // 同一 Pointer 已有 Owner（异常事件序列，防御）
    }

    const winner = this.claim(event);
    if (winner) {
      this.owners.set(event.pointerId, winner);
    }
  }

  /** pointermove：只路由给已持有所有权的 Pointer */
  onPointerMove(event: GesturePointerEvent): void {
    const owner = this.owners.get(event.pointerId);
    if (!owner) {
      return;
    }
    owner.onMove?.(event);
  }

  /** pointerup：结束该 Pointer 的手势生命周期 */
  onPointerUp(event: GesturePointerEvent): void {
    const owner = this.owners.get(event.pointerId);
    if (!owner) {
      return;
    }
    this.owners.delete(event.pointerId);
    owner.onUp?.(event);
  }

  /** pointercancel：浏览器打断（来电 / 通知 / 手势抢占）→ 按 cancel 释放 */
  onPointerCancel(event: GesturePointerEvent): void {
    const owner = this.owners.get(event.pointerId);
    if (!owner) {
      return;
    }
    this.owners.delete(event.pointerId);
    owner.onCancel?.(event);
  }

  /** window blur / 场景销毁：所有进行中的手势按 cancel 释放 */
  releaseAll(): void {
    const pointerIds = [...this.owners.keys()];
    for (const pointerId of pointerIds) {
      const owner = this.owners.get(pointerId);
      this.owners.delete(pointerId);
      owner?.onCancel?.({
        pointerId,
        pointerType: 'unknown',
        button: 0,
        x: -1,
        y: -1,
        clientX: -1,
        clientY: -1,
      });
    }
  }

  /** 未被占用的鼠标 move → Zone 悬停反馈（触摸指针不会传入，见 InputRouter） */
  notifyHover(event: GesturePointerEvent): void {
    if (this.owners.has(event.pointerId)) {
      return;
    }
    const containing = this.zones.find(
      (zone) => zone.isActive() && zone.contains(event.x, event.y)
    );
    if (this.lastHoveredZone && this.lastHoveredZone !== containing) {
      this.lastHoveredZone.onHover?.(false, event);
    }
    this.lastHoveredZone = containing ?? null;
    if (containing) {
      containing.onHover?.(true, event);
    }
  }

  private claim(event: GesturePointerEvent): GestureOwner | null {
    const candidates: ClaimCandidate[] = [];

    for (const zone of this.zones) {
      if (!zone.isActive() || !zone.contains(event.x, event.y)) {
        continue;
      }
      candidates.push({
        kind: zone.kind,
        order: this.orders.get(zone) ?? 0,
        // 箭头包装保留接收者：直接存 zone.onUp 会 detach 丢失 this
        owner: {
          onUp: (e) => zone.onUp?.(e),
          onCancel: (e) => zone.onCancel?.(e),
        },
        begin: (e) => {
          zone.onDown?.(e);
          return true;
        },
      });
    }
    for (const claimant of this.claimants) {
      candidates.push({
        kind: claimant.kind,
        order: this.orders.get(claimant) ?? 0,
        // 箭头包装保留接收者：直接存 claimant.onMove 会 detach 丢失 this
        owner: {
          onMove: (e) => claimant.onMove(e),
          onUp: (e) => claimant.onUp(e),
          onCancel: (e) => claimant.onCancel(e),
        },
        begin: (e) => claimant.tryClaim(e),
      });
    }

    // 稳定排序：优先级 → 注册顺序
    candidates.sort(
      (a, b) =>
        GESTURE_PRIORITY[a.kind] - GESTURE_PRIORITY[b.kind] ||
        a.order - b.order
    );

    for (const candidate of candidates) {
      if (candidate.begin(event)) {
        return candidate.owner;
      }
    }
    return null;
  }
}
