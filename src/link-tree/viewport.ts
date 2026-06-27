/**
 * viewport.ts — canvas 相机状态（无渲染依赖）
 *
 * Viewport 是一个不可变值对象，描述 canvas 的「相机」位置和缩放。
 * screen↔world 坐标换算是纯几何函数，不与任何 DOM/canvas 绑定。
 */

export interface Viewport {
  /** 世界原点在 canvas CSS 像素中的偏移 (x) */
  tx: number;
  /** 世界原点在 canvas CSS 像素中的偏移 (y) */
  ty: number;
  /** 缩放倍率（1 = 原始大小） */
  scale: number;
}

export const VIEWPORT_CLAMP = { minScale: 0.2, maxScale: 3 } as const;

/** 默认初始视口 */
export function defaultViewport(): Viewport {
  return { tx: 0, ty: 0, scale: 1 };
}

/** 屏幕 CSS 像素坐标 → 世界坐标（逆相机变换） */
export function screenToWorld(
  screenX: number,
  screenY: number,
  vp: Viewport,
): { x: number; y: number } {
  return {
    x: (screenX - vp.tx) / vp.scale,
    y: (screenY - vp.ty) / vp.scale,
  };
}

/** 缩放指向光标：保持 cursorWorld 在缩放前后对应同一屏幕位置 */
export function zoomAt(
  vp: Viewport,
  screenX: number,
  screenY: number,
  factor: number,
): Viewport {
  const w = screenToWorld(screenX, screenY, vp);
  const s = Math.max(
    VIEWPORT_CLAMP.minScale,
    Math.min(VIEWPORT_CLAMP.maxScale, vp.scale * factor),
  );
  return {
    tx: screenX - w.x * s,
    ty: screenY - w.y * s,
    scale: s,
  };
}

/** 拖动位移 */
export function pan(vp: Viewport, dx: number, dy: number): Viewport {
  return { ...vp, tx: vp.tx + dx, ty: vp.ty + dy };
}
