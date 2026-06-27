/**
 * hit-tester.test.ts — hitTest / hitCollapseIcon 测试
 */

import { describe, it, expect } from "vitest";
import { layoutTree, type LayoutNode } from "./tree-layout";
import { defaultViewport } from "./viewport";
import { hitTest, hitCollapseIcon } from "./hit-tester";

function node(id: string, children: LayoutNode[] = []): LayoutNode {
  return { id, children, collapsed: false };
}

const LAYOUT = layoutTree([node("box", [node("child")])]);
const VP = defaultViewport();
const BOX = LAYOUT.nodes.get("box")!;
const CHILD = LAYOUT.nodes.get("child")!;

describe("hitTest", () => {
  it("在节点区域内 → 命中", () => {
    const inside = { x: BOX.x + 10, y: BOX.y + 10 };
    const screen = { x: inside.x * VP.scale + VP.tx, y: inside.y * VP.scale + VP.ty };
    const hit = hitTest(screen.x, screen.y, VP, LAYOUT.nodes);
    expect(hit?.id).toBe("box");
  });

  it("在节点区域外 → 未命中", () => {
    const far = { x: BOX.x + BOX.w + 100, y: BOX.y + BOX.h + 100 };
    const screen = { x: far.x * VP.scale + VP.tx, y: far.y * VP.scale + VP.ty };
    expect(hitTest(screen.x, screen.y, VP, LAYOUT.nodes)).toBeNull();
  });

  it("缩放/平移后命中正确", () => {
    const vp = { tx: 50, ty: -30, scale: 1.5 };
    const world = { x: BOX.x + 10, y: BOX.y + 10 };
    const screen = { x: world.x * vp.scale + vp.tx, y: world.y * vp.scale + vp.ty };
    const h = hitTest(screen.x, screen.y, vp, LAYOUT.nodes);
    expect(h?.id).toBe("box");
  });
});

describe("hitCollapseIcon", () => {
  it("无子节点 → 不命中", () => {
    // 新建一个无孩子的根节点专门测试
    const single = layoutTree([node("alone")]);
    const screen = { x: 0, y: 0 }; // 任何点都不会命中
    expect(hitCollapseIcon(screen.x, screen.y, VP, single.nodes)).toBeNull();
  });
});
