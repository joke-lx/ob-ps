/**
 * tree-layout.ts — 树从左到右分层布局
 *
 * layoutTree(roots) → { positions, bounds }
 *
 * MVP 策略：自顶向下从左到右分层。叶子按序纵向排列，父节点垂直居中于其子。
 * Strategy 模式（可换 Reingold-Tilford / 径向 / 力导向）。
 */

// ---- 布局常量 ----

export const LAYOUT = {
  /** 节点宽度 */
  nodeW: 200,
  /** 节点高度 */
  nodeH: 44,
  /** 深度列之间的横向间距 */
  colGap: 54,
  /** 叶子之间的纵向间距 */
  rowGap: 16,
  /** 子树组之间的纵向间距 */
  forestGap: 44,
  /** 左上内边距 */
  padTop: 50,
  padLeft: 60,
} as const;

// ---- 布局结果 ----

export interface NodePos {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  /** 折叠时显示的后代数（完整树后代计数，非折叠子树计数） */
  descendantCount: number;
}

export interface LayoutResult {
  /** 节点坐标，按 id 索引 */
  nodes: Map<string, NodePos>;
  /** 布局总边界（用于 fitView） */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

// ---- 输入节点最小接口 ----

/** layoutTree 所需的树节点形状（与 TreeNode 解耦） */
export interface LayoutNode {
  id: string;
  children: LayoutNode[];
  collapsed: boolean;
}

// ---- 布局函数 ----

/**
 * 从左到右分层布局。
 *
 * @param roots  森林根节点数组（每个 root 递归含 children）
 * @returns      各节点坐标 + 总边界
 */
export function layoutTree(roots: LayoutNode[]): LayoutResult {
  const positions = new Map<string, NodePos>();
  const { nodeW, nodeH, colGap, rowGap, forestGap, padTop, padLeft } = LAYOUT;

  // 0. 后代计数（单遍后序遍历 O(n)）
  const desc = new Map<string, number>();
  function countDesc(n: LayoutNode): number {
    let d = 0;
    for (const c of n.children) d += 1 + countDesc(c);
    desc.set(n.id, d);
    return d;
  }
  for (const r of roots) countDesc(r);

  // 1. 递归布局
  let leaf = 0;

  function assign(n: LayoutNode, depth: number): NodePos {
    const isCollapsed = n.collapsed && n.children.length > 0;
    const hasChildren = n.children.length > 0;
    const dc = desc.get(n.id) ?? 0;

    const x = padLeft + depth * (nodeW + colGap);

    let y: number;
    if (!hasChildren || isCollapsed) {
      y = leaf * (nodeH + rowGap);
      leaf++;
    } else {
      const childPositions = n.children.map((c) => assign(c, depth + 1));
      const ys = childPositions.map((p) => p.y);
      y = (Math.min(...ys) + Math.max(...ys)) / 2;
    }

    const pos: NodePos = {
      id: n.id,
      x,
      y,
      w: nodeW,
      h: nodeH,
      depth,
      hasChildren,
      collapsed: isCollapsed,
      descendantCount: dc,
    };
    positions.set(n.id, pos);
    return pos;
  }

  for (const root of roots) {
    assign(root, 0);
    leaf += Math.round(forestGap / (nodeH + rowGap));
  }

  // 2. 计算边界
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of positions.values()) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + p.w > maxX) maxX = p.x + p.w;
    if (p.y + p.h > maxY) maxY = p.y + p.h;
  }

  return {
    nodes: positions,
    bounds: { minX, minY, maxX, maxY },
  };
}

/**
 * 从存储型 LayoutNode 映射为带显示坐标的 NodePos；
 * 供 canvas renderer 使用。
 */
export function nodePosById(layout: LayoutResult, id: string): NodePos | undefined {
  return layout.nodes.get(id);
}
