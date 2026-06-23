import { describe, it, expect } from "vitest";
import { pickClearUnresolvedContent } from "./clear-unresolved-modal";

describe("pickClearUnresolvedContent", () => {
  it("count=0: 不应出现(已由调用方拦截),但函数本身要稳", () => {
    const c = pickClearUnresolvedContent(0);
    expect(c.title).toBe("清除未解析双链");
    expect(c.confirmLabel).toBe("确认清除 0 处");
    expect(c.cancelLabel).toBe("取消");
  });

  it("count=12: 文案包含 12,confirm 显示具体条数", () => {
    const c = pickClearUnresolvedContent(12);
    expect(c.description).toContain("未解析 (12 条)");
    expect(c.description).toContain("12 条 [[未解析双链]]");
    expect(c.confirmLabel).toBe("确认清除 12 处");
  });

  it("description 提到不可撤销", () => {
    const c = pickClearUnresolvedContent(3);
    expect(c.description).toContain("不可撤销");
  });
});
