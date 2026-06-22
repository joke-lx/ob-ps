import { describe, it, expect } from "vitest";
import { pickModalContent } from "./repair-modal";

describe("pickModalContent", () => {
  it("not-exists: 启动按钮,无 secondary", () => {
    const c = pickModalContent({ kind: "not-exists" });
    expect(c.title).toContain("修复未解析双链");
    expect(c.primary.label).toBe("启动");
    expect(c.secondary).toBeNull();
  });

  it("running: 重启 + 查看输出,标题含运行中", () => {
    const c = pickModalContent({ kind: "running" });
    expect(c.title).toContain("运行中");
    expect(c.primary.label).toBe("重启");
    expect(c.secondary?.label).toBe("查看输出");
  });

  it("exited: 重启 + 查看输出,标题含已退出", () => {
    const c = pickModalContent({ kind: "exited" });
    expect(c.title).toContain("已退出");
    expect(c.primary.label).toBe("重启");
    expect(c.secondary?.label).toBe("查看输出");
  });

  it("三种状态都包含 skill 作用说明", () => {
    for (const kind of ["not-exists", "running", "exited"] as const) {
      const c = pickModalContent({ kind });
      expect(c.description.length).toBeGreaterThan(0);
    }
  });
});
