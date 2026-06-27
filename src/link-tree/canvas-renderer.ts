/**
 * canvas-renderer.ts — 画布渲染器
 *
 * 纯可视化组件：吃布局 + 边 + 视口，画到 canvas。
 * 不负责事件、不建树。
 */

import type { Viewport } from "./viewport";

// ---- 颜色主题 ----

export interface ThemeColors {
  created: string;
  pending: string;
  stale: string;
  accent: string;
  edge: string;
  edgeGhost: string;
  nodeBorder: string;
  nodeBorderSelected: string;
  labelText: string;
  labelStale: string;
  ghostBody: string;
  ghostBorder: string;
  ghostLabel: string;
  nodeBody: string;
  toggleBorder: string;
  toggleCollapsedBorder: string;
  toggleText: string;
  toggleBg: string;
  gridDot: string;
}

export const LIGHT_THEME: ThemeColors = {
  created: "#22a06b",
  pending: "#d97706",
  stale: "#9ca3af",
  accent: "#3b6ef7",
  edge: "#c4c9d2",
  edgeGhost: "#e2e5ea",
  nodeBorder: "#d8dce3",
  nodeBorderSelected: "#3b6ef7",
  labelText: "#1f2330",
  labelStale: "#9ca3af",
  ghostBody: "#f3f4f6",
  ghostBorder: "#b4b9c2",
  ghostLabel: "#6b7280",
  nodeBody: "#ffffff",
  toggleBorder: "#c4c9d2",
  toggleCollapsedBorder: "#3b6ef7",
  toggleText: "#6b7280",
  toggleBg: "#ffffff",
  gridDot: "#eceff3",
};

// ---- 绘制数据 ----

export interface DrawNode {
  id: string; x: number; y: number; w: number; h: number;
  label: string;
  isGhost: boolean; isStale: boolean; isCreated: boolean;
  depth: number; hasChildren: boolean; collapsed: boolean;
  descendantCount: number; runBadge?: string;
}

export interface DrawEdge {
  x1: number; y1: number; x2: number; y2: number; isGhost: boolean;
}

// ---- 渲染器 ----

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private theme: ThemeColors = { ...LIGHT_THEME };

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  setTheme(t: Partial<ThemeColors>): void { Object.assign(this.theme, t); }

  /** 全帧渲染 */
  render(
    canvas: HTMLCanvasElement,
    vp: Viewport,
    nodes: DrawNode[],
    edges: DrawEdge[],
    clickedId: string | null,
    activeId: string | null,
    hoveredId: string | null,
  ): void {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth | 0;
    const h = canvas.clientHeight | 0;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    this.drawGrid(w, h, vp);

    ctx.save();
    ctx.translate(vp.tx, vp.ty);
    ctx.scale(vp.scale, vp.scale);

    for (const e of edges) this.drawEdge(e);
    for (const n of nodes) if (n.isGhost) this.drawNodeBox(n, clickedId, activeId, hoveredId);
    for (const n of nodes) if (!n.isGhost) this.drawNodeBox(n, clickedId, activeId, hoveredId);
    for (const n of nodes) this.drawLabel(n);
    for (const n of nodes) this.drawToggle(n);

    ctx.restore();
  }

  // ---- 绘制原子 ----

  private drawGrid(w: number, h: number, vp: Viewport): void {
    const gap = Math.max(10, 24 * vp.scale);
    const ox = ((vp.tx % gap) + gap) % gap;
    const oy = ((vp.ty % gap) + gap) % gap;
    const ctx = this.ctx;
    ctx.fillStyle = this.theme.gridDot;
    for (let x = ox; x < w; x += gap) for (let y = oy; y < h; y += gap) ctx.fillRect(x, y, 1, 1);
  }

  private drawEdge(e: DrawEdge): void {
    const ctx = this.ctx;
    const mx = (e.x1 + e.x2) / 2;
    ctx.strokeStyle = e.isGhost ? this.theme.edgeGhost : this.theme.edge;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(e.x1, e.y1);
    ctx.bezierCurveTo(mx, e.y1, mx, e.y2, e.x2, e.y2);
    ctx.stroke();
  }

  private drawNodeBox(
    n: DrawNode,
    clickedId: string | null,
    activeId: string | null,
    hovId: string | null,
  ): void {
    const ctx = this.ctx;
    const t = this.theme;
    const isClicked = n.id === clickedId;
    const isActive = n.id === activeId;
    const isHov = n.id === hovId;
    const color = n.isStale ? t.stale : (n.isCreated ? t.created : t.pending);

    // hover 光晕（最底层）
    if (isHov) {
      ctx.fillStyle = "rgba(59,110,247,0.07)";
      this.rr(n.x - 5, n.y - 5, n.w + 10, n.h + 10, 11);
      ctx.fill();
    }
    // active 外环 + 背景（覆盖 hover，优先级更高）
    if (isActive) {
      ctx.fillStyle = "rgba(59,110,247,0.16)";
      this.rr(n.x - 5, n.y - 5, n.w + 10, n.h + 10, 11);
      ctx.fill();
    }
    // clicked 更强光晕（点击时短暂显示）
    if (isClicked) {
      ctx.fillStyle = "rgba(59,110,247,0.10)";
      this.rr(n.x - 8, n.y - 8, n.w + 16, n.h + 16, 13);
      ctx.fill();
    }

    if (n.isGhost) ctx.fillStyle = t.ghostBody;
    else ctx.fillStyle = t.nodeBody;
    this.rr(n.x, n.y, n.w, n.h, 8);
    ctx.fill();

    if (!n.isGhost) {
      ctx.fillStyle = color;
      this.rr(n.x, n.y, 4, n.h, 2);
      ctx.fill();
    }

    ctx.lineWidth = isActive ? 2 : 1;
    if (n.isGhost) {
      ctx.strokeStyle = t.ghostBorder;
      ctx.save();
      ctx.setLineDash([4, 3]);
      this.rr(n.x, n.y, n.w, n.h, 8);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = isActive
        ? t.accent
        : isClicked
          ? t.accent
          : t.nodeBorder;
      this.rr(n.x, n.y, n.w, n.h, 8);
      ctx.stroke();
    }

    if (!n.isGhost) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(n.x + 16, n.y + n.h / 2, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawLabel(n: DrawNode): void {
    const ctx = this.ctx;
    if (n.isGhost) {
      ctx.fillStyle = this.theme.ghostLabel;
      ctx.font = "12px -apple-system,sans-serif";
      this.fillText(ctx, "📁 " + n.label, n.x + 12, n.y + n.h / 2 + 4, n.w - 24);
    } else {
      ctx.fillStyle = n.isStale ? this.theme.labelStale : this.theme.labelText;
      if (n.isStale) ctx.globalAlpha = 0.65;
      ctx.font = "12.5px -apple-system,sans-serif";
      this.fillText(ctx, n.label, n.x + 28, n.y + n.h / 2 + 4, n.w - 64);
      ctx.globalAlpha = 1;
      if (n.runBadge) {
        ctx.fillStyle = "#9aa0ab";
        ctx.font = "10px -apple-system,sans-serif";
        ctx.fillText(n.runBadge, n.x + n.w - 24, n.y + 13);
      }
    }
  }

  private drawToggle(n: DrawNode): void {
    if (!n.hasChildren) return;
    const ctx = this.ctx;
    const t = this.theme;
    const cx = n.x + n.w + 13;
    const cy = n.y + n.h / 2;

    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fillStyle = t.toggleBg;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = n.collapsed ? t.toggleCollapsedBorder : t.toggleBorder;
    ctx.stroke();

    ctx.fillStyle = n.collapsed ? t.toggleCollapsedBorder : t.toggleText;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 11px -apple-system,sans-serif";
    ctx.fillText(n.collapsed ? String(n.descendantCount) : "−", cx, cy + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  // ---- 工具 ----

  private rr(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private fillText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number): void {
    if (ctx.measureText(text).width <= maxW) { ctx.fillText(text, x, y); return; }
    let lo = 0, hi = text.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ctx.measureText(text.slice(0, m) + "…").width <= maxW) lo = m + 1; else hi = m; }
    ctx.fillText(text.slice(0, Math.max(0, lo - 1)) + "…", x, y);
  }
}
