/**
 * hit-tester.ts — canvas 点击命中检测
 *
 * 给定屏幕坐标 + Viewport，逆变换到世界坐标后查询节点。
 * O(n) 遍历，数百节点足够快；上千后换网格/四叉树。
 */

import type { Viewport } from "./viewport";
import { screenToWorld } from "./viewport";
import type { NodePos } from "./tree-layout";

/**
 * 从屏幕 CSS 坐标检测命中的节点。
 *
 * @param screenX  canvas 元素内的 CSS 像素 x
 * @param screenY  canvas 元素内的 CSS 像素 y
 * @param vp       当前视口
 * @param nodes    布局结果中的节点 Map（id → NodePos）
 * @returns 命中节点（可能为 null）
 */
export function hitTest(
  screenX: number,
  screenY: number,
  vp: Viewport,
  nodes: Map<string, NodePos>,
): NodePos | null {
  const world = screenToWorld(screenX, screenY, vp);

  // 倒序遍历：后渲染的在上层（本文不涉及 z，倒序无实际影响，但保留习惯）
  const list = [...nodes.values()];
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    if (
      world.x >= n.x &&
      world.x <= n.x + n.w &&
      world.y >= n.y &&
      world.y <= n.y + n.h
    ) {
      return n;
    }
  }
  return null;
}

/**
 * 检测是否命中折叠/展开图标（节点右侧圆）。
 *
 * @returns 命中节点的 id（可能为 null）
 */
export function hitCollapseIcon(
  screenX: number,
  screenY: number,
  vp: Viewport,
  nodes: Map<string, NodePos>,
): NodePos | null {
  const world = screenToWorld(screenX, screenY, vp);
  const iconRadius = 9;
  const iconDx = 13; // 图标中心距节点右边缘的 x 偏移

  for (const n of nodes.values()) {
    if (!n.hasChildren) continue;
    const cx = n.x + n.w + iconDx;
    const cy = n.y + n.h / 2;
    const dx = world.x - cx;
    const dy = world.y - cy;
    if (dx * dx + dy * dy <= (iconRadius + 3) * (iconRadius + 3)) {
      return n;
    }
  }
  return null;
}
