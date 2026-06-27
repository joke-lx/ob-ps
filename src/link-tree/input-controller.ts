/**
 * input-controller.ts — canvas 输入控制器
 *
 * 管理 pointer / wheel / dblclick 事件，通过回调通知上层。
 * 不直接依赖 canvas 渲染或命中检测。
 */

export interface InputCallbacks {
  /** 缩放：传入光标屏幕坐标 + 倍率因子 */
  onZoom(screenX: number, screenY: number, factor: number): void;
  /** 平移 */
  onPan(dx: number, dy: number): void;
  /** 点击节点体 → 跳转 */
  onJump(nodeId: string): void;
  /** 点击折叠图标 → 折叠/展开 */
  onToggle(nodeId: string): void;
  /** 双击 → 复位视图 */
  onFit(): void;
  /** 悬停变更 */
  onHover(nodeId: string | null): void;
  /** 当前屏幕坐标 → 查命中节点体 / 折叠图标 */
  hitTest(screenX: number, screenY: number): { body: string | null; icon: string | null };
}

export class InputController {
  private el: HTMLCanvasElement | null = null;
  private cb: InputCallbacks | null = null;

  private dragging = false;
  private moved = false;
  private lastX = 0;
  private lastY = 0;
  private startX = 0;
  private startY = 0;
  private pointerDown = false;

  private boundOnPointerDown!: (e: PointerEvent) => void;
  private boundOnPointerMove!: (e: PointerEvent) => void;
  private boundOnPointerUp!: (e: PointerEvent) => void;
  private boundOnPointerLeave!: (e: PointerEvent) => void;
  private boundOnWheel!: (e: WheelEvent) => void;
  private boundOnDblClick!: (e: MouseEvent) => void;

  /** 挂载到 canvas */
  attach(el: HTMLCanvasElement, cb: InputCallbacks): void {
    this.detach();
    this.el = el;
    this.cb = cb;

    this.boundOnPointerDown = this.onPointerDown.bind(this);
    this.boundOnPointerMove = this.onPointerMove.bind(this);
    this.boundOnPointerUp = this.onPointerUp.bind(this);
    this.boundOnPointerLeave = this.onPointerLeave.bind(this);
    this.boundOnWheel = this.onWheel.bind(this);
    this.boundOnDblClick = this.onDblClick.bind(this);

    el.addEventListener("pointerdown", this.boundOnPointerDown);
    el.addEventListener("pointermove", this.boundOnPointerMove);
    el.addEventListener("pointerup", this.boundOnPointerUp);
    el.addEventListener("pointerleave", this.boundOnPointerLeave);
    el.addEventListener("wheel", this.boundOnWheel, { passive: false });
    el.addEventListener("dblclick", this.boundOnDblClick);
  }

  /** 卸载 */
  detach(): void {
    const el = this.el;
    if (!el) return;
    el.removeEventListener("pointerdown", this.boundOnPointerDown);
    el.removeEventListener("pointermove", this.boundOnPointerMove);
    el.removeEventListener("pointerup", this.boundOnPointerUp);
    el.removeEventListener("pointerleave", this.boundOnPointerLeave);
    el.removeEventListener("wheel", this.boundOnWheel);
    el.removeEventListener("dblclick", this.boundOnDblClick);
    this.el = null;
    this.cb = null;
  }

  // ---- 事件处理 ----

  private clientToLocal(clientX: number, clientY: number): { x: number; y: number } {
    if (!this.el) return { x: 0, y: 0 };
    const r = this.el.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  private onPointerDown(e: PointerEvent): void {
    this.el?.setPointerCapture(e.pointerId);
    this.dragging = true;
    this.moved = false;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.startX = e.clientX;
    this.startY = e.clientY;
  }

  private onPointerMove(e: PointerEvent): void {
    const cb = this.cb;
    if (!cb) return;

    if (this.dragging) {
      const dx = e.clientX - this.startX;
      const dy = e.clientY - this.startY;
      if (Math.hypot(dx, dy) > 3) this.moved = true;

      const panX = e.clientX - this.lastX;
      const panY = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;

      if (this.moved) {
        cb.onPan(panX, panY);
      }
    } else {
      // 悬停
      const local = this.clientToLocal(e.clientX, e.clientY);
      const hit = cb.hitTest(local.x, local.y);
      if (hit.icon) {
        cb.onHover(hit.icon);
      } else if (hit.body) {
        cb.onHover(hit.body);
      } else {
        cb.onHover(null);
      }
    }
  }

  private onPointerUp(e: PointerEvent): void {
    this.dragging = false;
    if (this.moved) return;

    const cb = this.cb;
    if (!cb) return;

    const local = this.clientToLocal(e.clientX, e.clientY);
    const hit = cb.hitTest(local.x, local.y);

    if (hit.icon) {
      cb.onToggle(hit.icon);
    } else if (hit.body) {
      cb.onJump(hit.body);
    }
  }

  private onPointerLeave(_e: PointerEvent): void {
    this.dragging = false;
    this.cb?.onHover(null);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const local = this.clientToLocal(e.clientX, e.clientY);
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.cb?.onZoom(local.x, local.y, factor);
  }

  private onDblClick(_e: MouseEvent): void {
    this.cb?.onFit();
  }

  /** 当前是否正在拖拽（供外部检查光标样式） */
  get isDragging(): boolean {
    return this.dragging;
  }
}
