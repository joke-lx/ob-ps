/**
 * link-tree-canvas.ts — 画布组件
 *
 * 自包含：管理 canvas、viewport、投影→布局→绘制管线、输入事件。
 * 外部只需 mount(container, callbacks) 和 update(events, deps)。
 */

import { CanvasRenderer, LIGHT_THEME, type DrawNode, type DrawEdge } from "./canvas-renderer";
import { defaultViewport, zoomAt, pan, screenToWorld, type Viewport } from "./viewport";
import { layoutTree, type LayoutNode } from "./tree-layout";
import { projectTree, type TreeNode, type ProjectDeps } from "./tree-projector";
import type { CreationEvent } from "./creation-event";

export interface CanvasCallbacks {
  onJump(event: CreationEvent): void;
  onCollapseChange?(collapsed: Set<string>): void;
}

const I_R = 9, I_DX = 13;

export class LinkTreeCanvas {
  private canvas!: HTMLCanvasElement;
  private renderer!: CanvasRenderer;
  private vp: Viewport = defaultViewport();
  private collapsed: Set<string> = new Set();
  private cb: CanvasCallbacks | null = null;

  // 当前绘制数据
  private nodes: DrawNode[] = [];
  private edges: DrawEdge[] = [];
  private layoutMap = new Map<string, { x: number; y: number; w: number; h: number; hasC: boolean; hid: string | null }>();
  private evMap = new Map<string, CreationEvent>();
  private hoverId: string | null = null;
  private selectedId: string | null = null;
  private firstUpdate = true;

  // 拖拽状态
  private drag = false;
  private moved = false;
  private p0: [number, number] = [0, 0];
  private pL: [number, number] = [0, 0];

  mount(container: HTMLElement, cb: CanvasCallbacks): void {
    this.cb = cb;
    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    container.appendChild(this.canvas);
    this.renderer = new CanvasRenderer(this.canvas.getContext("2d")!);
    this.bindEvents();
    window.addEventListener("resize", this._rs);
    try {
      this._ro = new ResizeObserver(() => {
        if (this.nodes.length > 0 && this.canvas && this.canvas.clientWidth > 0 && !this.firstUpdate) {
          this.fit();
          if (this.selectedId && this.layoutMap.has(this.selectedId)) {
            this._panToCenter(this.selectedId);
          }
        }
        this._rf();
      });
      this._ro.observe(this.canvas);
    } catch { /* 兼容性 fallback — window.resize 兜底 */ }
  }

  update(events: CreationEvent[], deps: ProjectDeps, highlightNodeId?: string | null): void {
    console.log("[link-tree] canvas.update events:", events.length);
    this.evMap.clear();
    for (const e of events) this.evMap.set(e.target, e);

    const treeRoots = projectTree(events, deps);
    console.log("[link-tree] projectTree roots:", treeRoots.length);

    // 建 LayoutNode 森林：带 ghost origin
    const ghostMap = new Map<string, TreeNode[]>();
    const bare: TreeNode[] = [];
    for (const r of treeRoots) {
      const sp = r.event.sourcePath;
      if (r.isStale || !sp.includes("/")) { bare.push(r); continue; }
      const arr = ghostMap.get(sp) ?? [];
      arr.push(r);
      ghostMap.set(sp, arr);
    }
    const ghostChildSet = new Set<string>();
    const layoutRoots: LayoutNode[] = [];
    for (const [sp, subs] of ghostMap) {
      for (const s of subs) ghostChildSet.add(s.event.target);
      layoutRoots.push({ id: sp, children: subs.map(t => this._tl(t)), collapsed: this.collapsed.has(sp) });
    }
    for (const r of bare) {
      if (!ghostChildSet.has(r.event.target)) {
        layoutRoots.push(this._tl(r));
      }
    }

    // 布局
    const layout = layoutTree(layoutRoots);

    // 构建绘制数据
    const la = this.layoutMap;
    la.clear();
    const nd: DrawNode[] = [];
    const ed: DrawEdge[] = [];
    const ghostIds = new Set(layoutRoots.filter(r => r.id.includes("/")).map(r => r.id));

    const walk = (n: LayoutNode): void => {
      const pos = layout.nodes.get(n.id);
      if (!pos) return;
      la.set(n.id, { x: pos.x, y: pos.y, w: pos.w, h: pos.h, hasC: pos.hasChildren, hid: ghostIds.has(n.id) ? this.canvas?.id ?? null : null });

      const isGhost = ghostIds.has(n.id);
      const ev = this.evMap.get(n.id);

      nd.push({
        id: n.id,
        x: pos.x, y: pos.y, w: pos.w, h: pos.h,
        label: isGhost ? n.id.split("/").pop() || n.id : n.id,
        isGhost, isStale: ev ? !deps.sourceExists(ev.sourcePath) : false,
        isCreated: ev ? deps.isResolved(ev.target, ev.sourcePath) : true,
        depth: pos.depth, hasChildren: pos.hasChildren,
        collapsed: pos.collapsed,
        descendantCount: pos.descendantCount,
        runBadge: ev?.runId,
      });

      for (const c of n.children) {
        const cp = layout.nodes.get(c.id);
        if (!cp) continue;
        ed.push({ x1: pos.x + pos.w, y1: pos.y + pos.h / 2, x2: cp.x, y2: cp.y + cp.h / 2, isGhost });
      }
      n.children.forEach(walk);
    }

    for (const r of layoutRoots) walk(r);

    console.log("[link-tree] drawNodes:", nd.length, "edges:", ed.length, "layoutNodes:", this.layoutMap.size);

    this.nodes = nd;
    this.edges = ed;

    if (this.firstUpdate) {
      this.selectedId = highlightNodeId ?? null;
      this.fit();
      if (this.selectedId && this.layoutMap.has(this.selectedId)) {
        this._panToCenter(this.selectedId);
      }
      this.firstUpdate = false;
    } else {
      // 后续刷新
      const highlightChanged = highlightNodeId !== this.selectedId;
      if (highlightChanged) {
        this.selectedId = highlightNodeId ?? null;
        if (this.selectedId && this.layoutMap.has(this.selectedId)) {
          this.fit();
          this._panToCenter(this.selectedId);
        } else {
          // 切换到不在树中的笔记 → 清除高亮，保持视口
        }
      }
    }

    this._rf();
  }

  private _tl(n: TreeNode): LayoutNode {
    return { id: n.event.target, children: n.children.map(c => this._tl(c)), collapsed: this.collapsed.has(n.event.target) };
  }

  // 输入
  private bindEvents(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", e => this._pd(e));
    c.addEventListener("pointermove", e => this._pm(e));
    c.addEventListener("pointerup", e => this._pu(e));
    c.addEventListener("pointerleave", () => this._pl());
    c.addEventListener("wheel", e => this._wh(e), { passive: false });
    c.addEventListener("dblclick", () => this.fit());
  }
  private _pos(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top];
  }
  private _pd(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.drag = true; this.moved = false;
    this.p0 = this._pos(e); this.pL = this.p0;
  }
  private _pm(e: PointerEvent): void {
    const [px, py] = this._pos(e);
    if (this.drag) {
      const dx = px - this.pL[0], dy = py - this.pL[1];
      if (Math.hypot(px - this.p0[0], py - this.p0[1]) > 3) this.moved = true;
      if (this.moved) { this.vp = pan(this.vp, dx, dy); this._rf(); }
      this.pL = [px, py];
    } else {
      const w = screenToWorld(px, py, this.vp);
      const hit = this._ht(w.x, w.y);
      this.hoverId = hit;
      this.canvas.style.cursor = hit ? "pointer" : "grab";
      this._rf();
    }
  }
  private _pu(e: PointerEvent): void {
    if (!this.moved && this.drag) {
      const [px, py] = this._pos(e);
      const w = screenToWorld(px, py, this.vp);
      if (this._hi(w.x, w.y)) return;
      const hit = this._ht(w.x, w.y);
      if (hit && this.evMap.has(hit)) {
        this.selectedId = hit;
        this.cb?.onJump(this.evMap.get(hit)!);
        this._rf();
      }
    }
    this.drag = false;
  }
  private _pl(): void { this.drag = false; this.hoverId = null; this._rf(); }
  private _wh(e: WheelEvent): void {
    e.preventDefault();
    const [px, py] = this._pos(e as unknown as PointerEvent);
    this.vp = zoomAt(this.vp, px, py, Math.exp(-e.deltaY * 0.0015));
    this._rf();
  }
  private _ht(wx: number, wy: number): string | null {
    for (const [id, n] of this.layoutMap) {
      if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return id;
    }
    return null;
  }
  private _hi(wx: number, wy: number): boolean {
    for (const [id, n] of this.layoutMap) {
      if (!n.hasC) continue;
      if (Math.hypot(wx - (n.x + n.w + I_DX), wy - (n.y + n.h / 2)) <= I_R + 3) {
        this.collapsed.has(id) ? this.collapsed.delete(id) : this.collapsed.add(id);
        this.cb?.onCollapseChange?.(this.collapsed);
        return true;
      }
    }
    return false;
  }
  fit(): void {
    if (!this.layoutMap.size) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of this.layoutMap.values()) {
      if (n.x < x0) x0 = n.x; if (n.y < y0) y0 = n.y;
      if (n.x + n.w > x1) x1 = n.x + n.w; if (n.y + n.h > y1) y1 = n.y + n.h + I_DX + I_R;
    }
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, p = 60;
    this.vp = defaultViewport();
    this.vp.scale = Math.min(2, Math.min(w / ((x1 - x0) + p), h / ((y1 - y0) + p)));
    this.vp.tx = (w - (x1 + x0) * this.vp.scale) / 2;
    this.vp.ty = (h - (y1 + y0) * this.vp.scale) / 2;
  }
  private _rs = () => this._rf();
  private _ro: ResizeObserver | null = null;
  private _rf(): void {
    if (!this.canvas || !this.renderer) return;
    this.renderer.render(this.canvas, this.vp, this.nodes, this.edges, this.selectedId, this.hoverId);
  }
  private _panToCenter(id: string): void {
    const n = this.layoutMap.get(id);
    if (!n) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    this.vp.tx = (w / 2) - cx * this.vp.scale;
    this.vp.ty = (h / 2) - cy * this.vp.scale;
  }
  setCollapsed(s: Set<string>): void {
    this.collapsed = s;
  }
  destroy(): void {
    if (this.canvas.parentElement) this.canvas.parentElement.removeChild(this.canvas);
    window.removeEventListener("resize", this._rs);
    try { this._ro?.disconnect(); } catch { }
  }
}
