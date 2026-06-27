/**
 * tree-layout.test.ts — layoutTree 纯函数测试
 */

import { describe, it, expect } from "vitest";
import { layoutTree, LAYOUT, type LayoutNode } from "./tree-layout";

function node(id: string, children: LayoutNode[] = [], collapsed = false): LayoutNode {
  return { id, children, collapsed };
}

describe("layoutTree", () => {
  it("单节点", () => {
    const r = layoutTree([node("a")]);
    expect(r.nodes.size).toBe(1);
    const pos = r.nodes.get("a")!;
    expect(pos.x).toBe(LAYOUT.padLeft);
    expect(pos.y).toBeGreaterThanOrEqual(0);
    expect(pos.w).toBe(LAYOUT.nodeW);
    expect(pos.h).toBe(LAYOUT.nodeH);
    expect(pos.depth).toBe(0);
  });

  it("单链 A→B：A 居中于 B，B 在 A 下方更大的 x", () => {
    const r = layoutTree([node("a", [node("b")])]);
    const a = r.nodes.get("a")!;
    const b = r.nodes.get("b")!;
    expect(a.depth).toBe(0);
    expect(b.depth).toBe(1);
    expect(b.x).toBeGreaterThan(a.x); // 从左到右
    expect(a.y).toBeCloseTo(b.y, 1);  // 父垂直居中于子
  });

  it("折叠节点当叶子处理：不占据子节点位置", () => {
    const nodes = [node("a", [node("b1", []), node("b2", [])])]; // 默认不折叠
    const r = layoutTree(nodes);
    const a = r.nodes.get("a")!;
    expect(r.nodes.size).toBe(3); // a + b1 + b2

    // 折叠后：b1、b2 不应出现
    const collapsedRoot = layoutTree([node("a", [node("b1"), node("b2")], true)]);
    expect(collapsedRoot.nodes.size).toBe(1);
  });

  it("bounds 包含所有节点", () => {
    const r = layoutTree([
      node("a", [node("b1"), node("b2")]),
    ]);
    const { bounds } = r;
    for (const pos of r.nodes.values()) {
      expect(pos.x).toBeGreaterThanOrEqual(bounds.minX);
      expect(pos.y).toBeGreaterThanOrEqual(bounds.minY);
      expect(pos.x + pos.w).toBeLessThanOrEqual(bounds.maxX);
      expect(pos.y + pos.h).toBeLessThanOrEqual(bounds.maxY);
    }
  });

  it("多根森林间有纵向间距", () => {
    const r = layoutTree([node("r1", [node("c")]), node("r2", [node("d")])]);
    const c = r.nodes.get("c")!;
    const d = r.nodes.get("d")!;
    // 多根森林的叶子应分布在不同的 y 范围（副根走森林间距）
    expect(Math.abs(c.y - d.y)).toBeGreaterThan(LAYOUT.rowGap);
  });

  it("空森林 → 空布局", () => {
    const r = layoutTree([]);
    expect(r.nodes.size).toBe(0);
    expect(r.bounds.minX).toBe(Infinity);
  });
});
