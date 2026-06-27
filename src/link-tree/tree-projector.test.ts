/**
 * tree-projector.test.ts — projectTree 纯函数测试
 */

import { describe, it, expect } from "vitest";
import { projectTree, type ProjectDeps } from "./tree-projector";
import type { CreationEvent } from "./creation-event";

/** 辅助：快速造事件 */
function ev(id: string, target: string, sourcePath: string, firstSeenAt = 0): CreationEvent {
  return { id, target, sourcePath, position: { line: 1, col: 0 }, firstSeenAt, runId: "R1" };
}

/** 假 ProjectDeps：默认全 resolved、全 exists */
const deps = (options?: {
  unresolved?: Set<string>;
  deleted?: Set<string>;
}): ProjectDeps => {
  const unresolved = options?.unresolved ?? new Set();
  const deleted = options?.deleted ?? new Set();
  return {
    isResolved(t, src) { return !unresolved.has(t); },
    sourceExists(p) { return !deleted.has(p); },
  };
};

describe("projectTree", () => {
  it("单根", () => {
    const events = [ev("e1", "B", "A.md")];
    const roots = projectTree(events, deps());
    expect(roots).toHaveLength(1);
    expect(roots[0].event.target).toBe("B");
    expect(roots[0].children).toHaveLength(0);
    expect(roots[0].depth).toBe(0);
  });

  it("单链 A→B→C", () => {
    const events = [
      ev("e1", "B", "A.md"),
      ev("e2", "C", "B.md"),    // source basename = B → child of e1
    ];
    const roots = projectTree(events, deps());
    expect(roots).toHaveLength(1);          // 只有一个根 B
    expect(roots[0].event.id).toBe("e1");
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children[0].event.id).toBe("e2");
    expect(roots[0].children[0].depth).toBe(1);
  });

  it("多根森林", () => {
    const events = [
      ev("e1", "B", "A.md"),
      ev("e2", "D", "C.md"),    // C 不在事件里 → 独立根
    ];
    const roots = projectTree(events, deps());
    expect(roots).toHaveLength(2);
    expect(roots[0].event.target).toBe("B");
    expect(roots[1].event.target).toBe("D");
  });

  it("按 firstSeenAt 顺序：先处理的事件为根，后处理的挂上去", () => {
    // e2 (C ← B.md) 有 firstSeenAt 50，先于 e1 (B ← A.md, 100) 被处理
    // → e2 找不到父（B 尚未被处理）→ 根；e1 找不到父 → 根
    const events = [
      ev("e2", "C", "B.md", 50),
      ev("e1", "B", "A.md", 100),
    ];
    const roots = projectTree(events, deps());
    expect(roots).toHaveLength(2);
    // 但若改为真实捕获顺序（先父后子），子应挂上：
    const events2 = [
      ev("e1", "B", "A.md", 50),   // 先捕获 B
      ev("e2", "C", "B.md", 100),  // 后捕获 C → 父 B 已存在 → 挂上
    ];
    const roots2 = projectTree(events2, deps());
    expect(roots2).toHaveLength(1);
    expect(roots2[0].event.target).toBe("B");
    expect(roots2[0].children).toHaveLength(1);
    expect(roots2[0].children[0].event.target).toBe("C");
  });

  it("status 派生：target 已解析 → created", () => {
    const events = [ev("e1", "B", "A.md")];
    const roots = projectTree(events, deps({ unresolved: new Set() }));
    expect(roots[0].status).toBe("created");
  });

  it("status 派生：target 未解析 → pending", () => {
    const events = [ev("e1", "B", "A.md")];
    const roots = projectTree(events, deps({ unresolved: new Set(["B"]) }));
    expect(roots[0].status).toBe("pending");
  });

  it("isStale 派生：源笔记被删 → true", () => {
    const events = [ev("e1", "B", "A.md")];
    const roots = projectTree(events, deps({ deleted: new Set(["A.md"]) }));
    expect(roots[0].isStale).toBe(true);
  });

  it("同 target 多事件：parent 匹配用最新的事件", () => {
    const events = [
      ev("e_new", "B", "C.md", 10),
      ev("e_child", "D", "B.md", 50),
      ev("e_old", "B", "A.md", 99),
    ];
    const roots = projectTree(events, deps());
    expect(roots).toHaveLength(2); // B(C.md) 根, B(A.md) 根
    const parent = roots.find(r => r.event.id === "e_new")!;
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].event.id).toBe("e_child");
    const old = roots.find(r => r.event.id === "e_old")!;
    expect(old.children).toHaveLength(0);
  });

  it("自身引用：target == basename(sourcePath) → 跳过", () => {
    const events = [
      ev("e1", "A", "A.md"), // source basename = "A" = target → 自身引用
    ];
    const roots = projectTree(events, deps());
    expect(roots).toHaveLength(1);  // 不会自我挂载
    expect(roots[0].children).toHaveLength(0);
  });

  it("空输入 → 空输出", () => {
    expect(projectTree([], deps())).toEqual([]);
  });
});
