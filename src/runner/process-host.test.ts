import { describe, it, expect } from "vitest";
import type { RunnerTab } from "./process-model";
import { resolveOrCreateTab } from "./process-host";

function makeTab(command: string, cwd: string): RunnerTab {
  return {
    id: `id-${Math.random()}`,
    name: "n",
    command,
    cwd,
    status: "stopped",
    exitCode: null,
    output: "",
    child: null,
  };
}

describe("resolveOrCreateTab", () => {
  it("空数组时新建 tab,created=true", () => {
    const { tab, created } = resolveOrCreateTab([], "name", "cmd", "/cwd");
    expect(created).toBe(true);
    expect(tab.name).toBe("name");
    expect(tab.command).toBe("cmd");
    expect(tab.cwd).toBe("/cwd");
    expect(tab.status).toBe("stopped");
    expect(tab.child).toBeNull();
    expect(tab.exitCode).toBeNull();
    expect(tab.output).toBe("");
    // 验证 id 非空
    expect(typeof tab.id).toBe("string");
    expect(tab.id.length).toBeGreaterThan(0);
  });

  it("存在同名 command 时复用,created=false", () => {
    const existing = makeTab("cmd", "/old");
    const { tab, created } = resolveOrCreateTab(
      [existing],
      "different name",
      "cmd",
      "/new",
    );
    expect(created).toBe(false);
    expect(tab).toBe(existing);
  });

  it("command 不同时按 command 匹配,不会误复用", () => {
    const a = makeTab("cmd-a", "/");
    const b = makeTab("cmd-b", "/");
    const { tab, created } = resolveOrCreateTab(
      [a, b],
      "n",
      "cmd-c",
      "/",
    );
    expect(created).toBe(true);
    expect(tab.command).toBe("cmd-c");
  });

  it("复用时返回的 tab 引用不被修改 cwd", () => {
    const existing = makeTab("cmd", "/original");
    const { tab } = resolveOrCreateTab([existing], "n", "cmd", "/new");
    expect(tab.cwd).toBe("/original");
  });
});
