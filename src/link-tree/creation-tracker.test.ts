/**
 * creation-tracker.test.ts — capture 纯函数测试
 */

import { describe, it, expect } from "vitest";
import { capture, buildDedupSet, type LinkRowLite } from "./creation-tracker";

/** 辅助：快速造 LinkRowLite */
function unresolved(
  target: string,
  sourcePath: string,
  sourceCtime: number,
  line?: number,
): LinkRowLite {
  return {
    target,
    sourcePath,
    sourceCtime,
    state: "unresolved",
    position: line != null ? { line, col: 0 } : undefined,
  };
}
function resolved(
  target: string,
  sourcePath: string,
  sourceCtime: number,
): LinkRowLite {
  return { target, sourcePath, sourceCtime, state: "resolved" };
}

describe("capture", () => {
  it("从多条未解析中提取事件", () => {
    const rows: LinkRowLite[] = [
      unresolved("B", "A.md", 100),
      unresolved("C", "B.md", 200),
    ];
    const events = capture(rows, new Set(), "R1", 1000);
    expect(events).toHaveLength(2);
    expect(events[0].target).toBe("B");
    expect(events[0].sourcePath).toBe("A.md");
    expect(events[0].runId).toBe("R1");
    expect(events[0].firstSeenAt).toBe(1000);
  });

  it("去重：已有 target 跳过", () => {
    const rows = [unresolved("B", "A.md", 100), unresolved("C", "D.md", 200)];
    const existing = new Set(["B"]); // B 已存在日志
    const events = capture(rows, existing, "R1", 1000);
    expect(events).toHaveLength(1);
    expect(events[0].target).toBe("C");
  });

  it("主源选择：多源取最大 ctime", () => {
    const rows = [
      unresolved("B", "A.md", 100),
      unresolved("B", "C.md", 300), // ctime 更大 → 应为主源
      unresolved("B", "D.md", 50),
    ];
    const events = capture(rows, new Set(), "R1", 1000);
    expect(events).toHaveLength(1);
    expect(events[0].sourcePath).toBe("C.md");
    expect(events[0].position).toEqual({ line: 0, col: 0 });
  });

  it("已解析行不产生事件", () => {
    const rows = [
      unresolved("B", "A.md", 100),
      resolved("B", "A.md", 100),
    ];
    const events = capture(rows, new Set(), "R1", 1000);
    expect(events).toHaveLength(1); // 只有一条 unresolved
  });

  it("空输入 → 空输出", () => {
    expect(capture([], new Set(), "R1", 0)).toEqual([]);
  });

  it("未解析为空 → 空输出", () => {
    const rows = [resolved("B", "A.md", 100)];
    expect(capture(rows, new Set(), "R1", 0)).toEqual([]);
  });

  it("位置缺失时 fallback 到 {line:0, col:0}", () => {
    const rows: LinkRowLite[] = [
      { target: "B", sourcePath: "A.md", sourceCtime: 100, state: "unresolved" },
    ];
    const events = capture(rows, new Set(), "R1", 0);
    expect(events[0].position).toEqual({ line: 0, col: 0 });
  });
});

describe("buildDedupSet", () => {
  it("按 normalizeTarget 去重", () => {
    const events = [
      { id: "1", target: "B", sourcePath: "A.md", position: { line: 1, col: 0 }, firstSeenAt: 1, runId: "R1" },
      { id: "2", target: "B#anchor", sourcePath: "C.md", position: { line: 2, col: 0 }, firstSeenAt: 2, runId: "R1" },
    ];
    const set = buildDedupSet(events);
    expect(set.size).toBe(1); // 按 normalized "B" 去重
    expect(set.has("B")).toBe(true);
  });
});
