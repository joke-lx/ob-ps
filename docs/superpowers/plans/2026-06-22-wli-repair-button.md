# wli-section-head 修复未解析双链按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Wikilink Inspector 视图的"未解析"分组头部右侧添加一个按钮，点击后通过 `RunnerView` 启动一个 `claude --dangerously-skip-permissions -p "/obsidian-repair-unresolved-links"` 进程；首次点击会自动处理 `repairLinksSkillInstalled` 开关与磁盘状态。

**Architecture:** 在 `src/runner/` 下新增 `process-host.ts` 暴露最小契约 `RunnerHost`（仅一个 `startOrCreateTab` 方法），`RunnerView` 实现该 host；`WikilinkInspectorView` 通过 `InspectorViewOptions.onRepairUnresolvedLinks` 回调委托给 `main.ts` 编排，编排方法负责 skill 开关自洽 + 拿到 RunnerView 实例 + 调用 host。复用现有 `startProcess` 幂等语义，按 command 复用同名 tab。

**Tech Stack:** TypeScript + esbuild + Obsidian Plugin API（≥1.7.2），ESM，vitest（纯逻辑单测，已就绪），eslint（含 `eslint-plugin-obsidianmd`）。

## Global Constraints

- **平台**：仅桌面端（依赖 `child_process`）。
- **Obsidian 版本**：≥ 1.7.2。
- **代码风格**：遵循现有约定——文件 200–400 行、中文注释、Obsidian `createDiv/createSpan/setIcon` DOM 助手、`type` 导入用 `import type`。
- **Lint 规则**：`eslint-plugin-obsidianmd` 会拦截 `console.log/info/warn/error` 的自定义前缀（调试用 `console.debug`）。每个任务提交前必须 `npm run lint` 通过。
- **构建**：`npm run build` = `tsc -noEmit -skipLibCheck && esbuild --production`，产物为根目录 `main.js`。每个 UI 任务结束前必须 build 通过。
- **测试**：`npm test` 跑 vitest。纯逻辑测试放 `src/**/*.test.ts`，**禁止 import `obsidian`**。
- **提交**：Conventional Commits，每个任务结束提交一次，commit message 末尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。本计划全程**只本地提交、不推送**（用户会话偏好）。
- **CSS 命名前缀**：新增样式统一用 `wli-` 前缀，与现有 `runner-` 不冲突。
- **已决开放问题**（来自 spec 第 9 节，本计划定型）：
  - 按钮只在 `key === "unresolved"` 的 head 渲染，已解析 head 不变。
  - 复用同名进程按 `command` 全等匹配。
  - 不跳转 RunnerView；启动后用户手动打开右侧栏查看。
  - skill 缺失时引导去设置页（`openSettings()`，不切视图）。

---

## File Structure

| 文件 | 责任 | 新建/修改 |
|------|------|----------|
| `src/runner/process-host.ts` | `RunnerHost` 接口 + `REPAIR_UNRESOLVED_LINKS_*` 常量 + `resolveOrCreateTab` 纯函数 | 新建 |
| `src/runner/process-host.test.ts` | `resolveOrCreateTab` 单测 | 新建 |
| `src/runner/index.ts` | re-export 新内容 | 修改 |
| `src/view/runner-view.ts` | 新增公共方法 `startOrCreateTab`（薄壳） | 修改 |
| `src/wikilink-inspector/inspector-view.ts` | `renderSection` 给 unresolved head 加按钮；新增 `onRepairBtnClick` | 修改 |
| `src/wikilink-inspector/index.ts` | `InspectorViewOptions` 加 `onRepairUnresolvedLinks?` 字段 | 修改 |
| `main.ts` | 新增 `onRepairUnresolvedLinks` 与 `getOrActivateRunnerView` 编排方法；注入回调 | 修改 |
| `styles.css` | `.wli-section-action` 规则 | 修改 |

---

## Task 1: 新增 `RunnerHost` 契约与纯函数（先 TDD）

**Files:**
- Create: `src/runner/process-host.ts`
- Create: `src/runner/process-host.test.ts`
- Modify: `src/runner/index.ts`

**Interfaces:**
- Produces:
  - `interface RunnerHost { startOrCreateTab(name: string, command: string, cwd: string): RunnerTab }`
  - `const REPAIR_UNRESOLVED_LINKS_TAB_NAME: "修复未解析双链"`
  - `const REPAIR_UNRESOLVED_LINKS_COMMAND: 'claude --dangerously-skip-permissions -p "/obsidian-repair-unresolved-links"'`
  - `function resolveOrCreateTab(tabs: RunnerTab[], name: string, command: string, cwd: string): { tab: RunnerTab; created: boolean }`

- [ ] **Step 1: 写失败的测试**

Create `src/runner/process-host.test.ts`:

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
npm test -- src/runner/process-host.test.ts
```
Expected: FAIL，错误信息包含 `Cannot find module './process-host'` 或 `resolveOrCreateTab is not a function`。

- [ ] **Step 3: 实现 `process-host.ts`**

Create `src/runner/process-host.ts`:

```ts
import { createTab } from "./process-factory";
import type { RunnerTab } from "./process-model";

/** 启动或创建进程标签页的最小能力 —— 由 RunnerView 实现 */
export interface RunnerHost {
  /**
   * 若 command 已存在则复用并启动;否则新建标签页并启动。
   * 不切换视图、不弹出 UI。
   */
  startOrCreateTab(name: string, command: string, cwd: string): RunnerTab;
}

/** 修复未解析双链进程标签页的显示名称 */
export const REPAIR_UNRESOLVED_LINKS_TAB_NAME = "修复未解析双链";

/** 修复未解析双链进程标签页的 shell 命令 */
export const REPAIR_UNRESOLVED_LINKS_COMMAND =
  'claude --dangerously-skip-permissions -p "/obsidian-repair-unresolved-links"';

/**
 * 在已有 tabs 中查找同名 command;若不存在则创建新 tab。
 * 纯函数 —— 不修改入参数组,便于单测。
 */
export function resolveOrCreateTab(
  tabs: RunnerTab[],
  name: string,
  command: string,
  cwd: string,
): { tab: RunnerTab; created: boolean } {
  const existing = tabs.find((t) => t.command === command);
  if (existing) {
    return { tab: existing, created: false };
  }
  return { tab: createTab(name, command, cwd), created: true };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
npm test -- src/runner/process-host.test.ts
```
Expected: 4 个测试全部 PASS。

- [ ] **Step 5: 在 `src/runner/index.ts` re-export**

Modify `src/runner/index.ts`，在 `export { createTab } from "./process-factory";` 后追加：

```ts
export type { RunnerHost } from "./process-host";
export {
  REPAIR_UNRESOLVED_LINKS_TAB_NAME,
  REPAIR_UNRESOLVED_LINKS_COMMAND,
  resolveOrCreateTab,
} from "./process-host";
```

Run:
```bash
npm test -- src/runner/process-host.test.ts
```
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/runner/process-host.ts src/runner/process-host.test.ts src/runner/index.ts
git commit -m "feat(runner): 新增 RunnerHost 契约与 resolveOrCreateTab 纯函数" --message-args=--trailer="Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> 备注：Windows cmd 不支持 `--message-args` 形式。改用：
```bash
git add src/runner/process-host.ts src/runner/process-host.test.ts src/runner/index.ts
git commit -m "feat(runner): 新增 RunnerHost 契约与 resolveOrCreateTab 纯函数

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `RunnerView.startOrCreateTab` 公共方法

**Files:**
- Modify: `src/view/runner-view.ts`（在 `setTabsFromConfigs` 之后新增公共方法）

**Interfaces:**
- Consumes: `resolveOrCreateTab` from `../runner`
- Produces: `RunnerView.startOrCreateTab(name: string, command: string, cwd: string): RunnerTab`

- [ ] **Step 1: 在 `RunnerView` 加 import**

在 `src/view/runner-view.ts` 的 import 区域，把：

```ts
import {
  isRunning,
  type RunnerTab,
  startProcess,
  stopProcess,
} from "../runner";
```

改为：

```ts
import {
  isRunning,
  resolveOrCreateTab,
  type RunnerTab,
  startProcess,
  stopProcess,
} from "../runner";
```

- [ ] **Step 2: 在 `setTabsFromConfigs` 之后插入公共方法**

定位：`setTabsFromConfigs` 紧跟着 `// ---- Public API for main.ts -----------------------------------------------` 注释。找到该方法的 `}` 闭合大括号（紧接 `saveConfigs()` 调用之前），插入：

```ts
  /**
   * Host 接口实现:若 command 已存在则复用并启动;否则新建并启动。
   * 不切换视图;复用时不修改原 tab 的 cwd。
   */
  startOrCreateTab(name: string, command: string, cwd: string): RunnerTab {
    const { tab, created } = resolveOrCreateTab(this.tabs, name, command, cwd);
    if (created) {
      this.tabs.push(tab);
      this.expandedIds.add(tab.id);
      this.expandScrollId = tab.id;
      this.saveConfigs();
      this.renderAll();
    }
    // 复用与新建均启动 —— startProcess 内部幂等（已在运行时则早退）
    tab.output = "";
    startProcess(tab, () => this.scheduleRender());
    return tab;
  }
```

- [ ] **Step 3: build 与 lint 验证**

Run:
```bash
npm run build
```
Expected: 无错误,根目录无新增文件或仅 `main.js` 被更新（构建产物）。

Run:
```bash
npm run lint
```
Expected: 无错误。

- [ ] **Step 4: 跑全量测试确认未回归**

Run:
```bash
npm test
```
Expected: 全部已有测试 PASS（无回归）。

- [ ] **Step 5: Commit**

```bash
git add src/view/runner-view.ts
git commit -m "feat(view): RunnerView 实现 RunnerHost 公共方法 startOrCreateTab

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 扩展 `InspectorViewOptions` 类型

**Files:**
- Modify: `src/wikilink-inspector/index.ts`

**Interfaces:**
- Produces: `InspectorViewOptions.onRepairUnresolvedLinks?: () => void | Promise<void>`

- [ ] **Step 1: 修改 `index.ts` re-export 类型**

Modify `src/wikilink-inspector/index.ts`，把：

```ts
export {
  WIKILINK_INSPECTOR_VIEW_TYPE,
  WikilinkInspectorView,
  type InspectorViewOptions,
} from "./inspector-view";
```

改为：

```ts
export {
  WIKILINK_INSPECTOR_VIEW_TYPE,
  WikilinkInspectorView,
  type InspectorViewOptions,
  type RepairUnresolvedLinksHandler,
} from "./inspector-view";
```

（这要求 `inspector-view.ts` 单独 export 一个 `RepairUnresolvedLinksHandler` 类型 — 在 Task 4 一起改。这里先调整 index.ts，等 Task 4 完成后再 build；中间步骤不要求 build 通过，但 lint 要求改对。）

- [ ] **Step 2: lint 验证**

Run:
```bash
npm run lint
```
Expected: 此时**会**因为 `inspector-view.ts` 还没 export `RepairUnresolvedLinksHandler` 而报错 `Module ... has no exported member 'RepairUnresolvedLinksHandler'`。这是预期的 —— 留到 Task 4 解决。**不要先 commit**。

---

## Task 4: `WikilinkInspectorView` 加按钮与点击回调

**Files:**
- Modify: `src/wikilink-inspector/inspector-view.ts`

**Interfaces:**
- Consumes: `RepairUnresolvedLinksHandler` 类型 + `InspectorViewOptions.onRepairUnresolvedLinks`
- Produces: unresolved head 上的 `.wli-section-action` 按钮,点击调 `opts.onRepairUnresolvedLinks()`

- [ ] **Step 1: 引入类型与 setIcon**

定位 `src/wikilink-inspector/inspector-view.ts` 顶部 import,把：

```ts
import { ItemView, MarkdownView, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type { App, CachedMetadata } from "obsidian";
```

保持不变（`setIcon` 已在 import 中）。

在 `WikilinkInspectorView` 类**外**、import 之后新增类型 export：

```ts
/** 修复未解析双链按钮的点击处理 —— 由 main.ts 注入 */
export type RepairUnresolvedLinksHandler = () => void | Promise<void>;
```

- [ ] **Step 2: 扩展 `InspectorViewOptions`**

把：

```ts
export interface InspectorViewOptions {
  onOpenRunner: () => void;
}
```

改为：

```ts
export interface InspectorViewOptions {
  onOpenRunner: () => void;
  /** 点击「修复未解析双链」按钮时触发;由 main.ts 实现 */
  onRepairUnresolvedLinks?: RepairUnresolvedLinksHandler;
}
```

- [ ] **Step 3: 在 unresolved head 加按钮**

定位 `renderSection` 方法（位于 `src/wikilink-inspector/inspector-view.ts:165` 附近）。找到 `head.addEventListener("click", ...)` 这一行（折叠切换 listener），**之前**插入：

```ts
    // 修复未解析双链按钮 —— 仅在 unresolved 分组显示
    if (key === "unresolved" && this.opts.onRepairUnresolvedLinks) {
      const action = head.createDiv({
        cls: "wli-section-action",
        title: "修复未解析双链",
        attr: { "aria-label": "修复未解析双链" },
      });
      setIcon(action, "wand-2");
      action.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.onRepairBtnClick();
      });
    }
```

- [ ] **Step 4: 新增 `onRepairBtnClick` 私有方法**

定位 `renderSection` 方法之后、`// ---- 定"位居取 MarkdownView` 注释之前，插入：

```ts
  /** 修复按钮点击 —— 委托给 main.ts 编排方法 */
  private async onRepairBtnClick(): Promise<void> {
    const handler = this.opts.onRepairUnresolvedLinks;
    if (!handler) {
      new Notice("修复未解析双链功能未配置");
      return;
    }
    await handler();
  }
```

- [ ] **Step 5: build 与 lint 验证**

Run:
```bash
npm run build
```
Expected: 通过。

Run:
```bash
npm run lint
```
Expected: 无错误。

- [ ] **Step 6: 跑全量测试**

Run:
```bash
npm test
```
Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add src/wikilink-inspector/inspector-view.ts src/wikilink-inspector/index.ts
git commit -m "feat(wli): 未解析分组 head 右侧添加修复按钮

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `main.ts` 编排方法与回调注入

**Files:**
- Modify: `main.ts`

**Interfaces:**
- Consumes: `REPAIR_UNRESOLVED_LINKS_TAB_NAME`、`REPAIR_UNRESOLVED_LINKS_COMMAND`、`RunnerView`
- Produces: `onRepairUnresolvedLinks()` 与 `getOrActivateRunnerView()` 两个私有方法;`registerView(WIKILINK_INSPECTOR_VIEW_TYPE, ...)` 注入 `onRepairUnresolvedLinks` 回调

- [ ] **Step 1: 扩展 import**

定位 `main.ts` 顶部 import，把：

```ts
import { RUNNER_VIEW_TYPE, RunnerView, type ViewOptions } from "./src/view";
```

改为：

```ts
import { RUNNER_VIEW_TYPE, RunnerView, type ViewOptions } from "./src/view";
import {
  REPAIR_UNRESOLVED_LINKS_COMMAND,
  REPAIR_UNRESOLVED_LINKS_TAB_NAME,
} from "./src/runner";
```

- [ ] **Step 2: 注入回调**

定位 `registerView(WIKILINK_INSPECTOR_VIEW_TYPE, ...)` 调用（位于 onload 第 10 步）。把：

```ts
    this.registerView(WIKILINK_INSPECTOR_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      const opts: InspectorViewOptions = {
        onOpenRunner: () => void this.activateView(),
      };
      return new WikilinkInspectorView(leaf, opts);
    });
```

改为：

```ts
    this.registerView(WIKILINK_INSPECTOR_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      const opts: InspectorViewOptions = {
        onOpenRunner: () => void this.activateView(),
        onRepairUnresolvedLinks: () => this.onRepairUnresolvedLinks(),
      };
      return new WikilinkInspectorView(leaf, opts);
    });
```

- [ ] **Step 3: 新增编排方法**

定位 `getDefaultCwd()` 方法之后（位于 `// ---- 内部辅助 --------------------------------------------------------------` 注释之前），插入：

```ts
  /**
   * 编排「修复未解析双链」流程:skill 开关自洽 → 拿到 RunnerView → 启动进程。
   * 不跳转 RunnerView（用户手动打开右侧栏查看）。
   */
  async onRepairUnresolvedLinks(): Promise<void> {
    const vault = this.getDefaultCwd();
    if (!vault) {
      new Notice("无法获取 vault 路径");
      return;
    }

    // 1) 磁盘实际未安装 → 引导去设置页, 不启动
    if (!isSkillInstalled(vault)) {
      new Notice(
        "请先在「设置 → Local Runner」安装 obsidian-repair-unresolved-links skill",
      );
      await this.openSettings();
      return;
    }

    // 2) 磁盘已装但开关未开 → 自动开 + 落盘
    if (!this.settings.repairLinksSkillInstalled) {
      this.settings.repairLinksSkillInstalled = true;
      await this.saveSettings();
    }

    // 3) 确保 RunnerView 实例就绪 (不 reveal, 留用户在原视图)
    const view = await this.getOrActivateRunnerView();
    if (!view) {
      new Notice("无法获取本地进程视图");
      return;
    }

    // 4) 启动 (复用同名 或 新建)
    view.startOrCreateTab(
      REPAIR_UNRESOLVED_LINKS_TAB_NAME,
      REPAIR_UNRESOLVED_LINKS_COMMAND,
      vault,
    );
  }

  /**
   * 拿 RunnerView 实例;若不存在则通过 activateView() 创建并等待 onOpen 完成。
   * 不调用 revealLeaf —— 按设计不跳转。
   */
  private async getOrActivateRunnerView(): Promise<RunnerView | null> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(RUNNER_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: RUNNER_VIEW_TYPE, active: true });
    }
    const view = leaf.view;
    return view instanceof RunnerView ? view : null;
  }
```

- [ ] **Step 4: build 与 lint 验证**

Run:
```bash
npm run build
```
Expected: 通过。

Run:
```bash
npm run lint
```
Expected: 无错误。

- [ ] **Step 5: 跑全量测试**

Run:
```bash
npm test
```
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add main.ts
git commit -m "feat(main): 编排修复未解析双链流程

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: CSS 样式

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: 添加 `.wli-section-action` 规则**

定位 `styles.css` 中 `/* 状态色点（绿=已解析，蓝=未解析，与笔记内高亮一致） */` 注释之前（位于 `wli-section` 相关样式块末尾），插入：

```css
/* head 右侧动作按钮 —— 修复未解析双链 */
.wli-section-action {
  margin-left: auto;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.wli-section-action:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
.wli-section-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 2: lint 验证**

Run:
```bash
npm run lint
```
Expected: 无错误（CSS 不参与 lint，但保险起见跑一遍确认整体 OK）。

- [ ] **Step 3: 手动视觉验证**

启动 `npm run dev` 并在 Obsidian 中加载本插件,开启双链检查侧边栏,确认:
- 未解析分组 head 右侧出现 wand-2 图标。
- 鼠标悬停按钮有背景高亮。
- 点击不触发 head 的折叠切换。
- 已解析分组的 head 不显示按钮。

- [ ] **Step 4: Commit**

```bash
git add styles.css
git commit -m "style(wli): 添加修复按钮样式 .wli-section-action

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 集成验证 + 收尾

**Files:**
- 不修改新文件,只跑命令

- [ ] **Step 1: 跑全量测试**

Run:
```bash
npm test
```
Expected: 全部 PASS。

- [ ] **Step 2: build 验证**

Run:
```bash
npm run build
```
Expected: 无错误。

- [ ] **Step 3: lint 验证**

Run:
```bash
npm run lint
```
Expected: 无错误。

- [ ] **Step 4: 端到端验证清单**

依次在 Obsidian 中验证：
- [ ] 启用「双链检查」侧边栏
- [ ] 未解析分组 head 右侧看到 wand-2 图标
- [ ] 点击 → 进程在 RunnerView 中以"修复未解析双链"标签页启动
- [ ] 再次点击同名 command → 复用既有 tab（不再 push 新条目）
- [ ] 卸载 skill、关闭开关 → 点击触发 Notice + 设置页跳转（**注意**：要测试该路径需要先 `uninstallSkill`，执行前手动确认用户期望）
- [ ] 点击按钮不会触发 head 的折叠切换（stopPropagation 生效）

- [ ] **Step 5: 检查 git status 干净**

Run:
```bash
git status
```
Expected: 无未提交修改（除 `styles.css` 上次颜色调整之外）。

- [ ] **Step 6: 总结报告**

向用户报告：所有任务完成,build / lint / test 全通过,等待用户验收 + 决定是否推送。

---

## Self-Review

### 1. Spec coverage

| Spec 节 | 对应任务 |
|---|---|
| §1 架构与边界（RunnerHost） | Task 1, Task 2 |
| §2 数据流 | Task 4 (按钮) + Task 5 (编排) |
| §3 Skill 开关自洽 | Task 5 (`onRepairUnresolvedLinks`) |
| §4 命令与标签页常量 | Task 1 |
| §5 `RunnerView.startOrCreateTab` 实现 | Task 1 (纯函数) + Task 2 (薄壳) |
| §6 UI / CSS | Task 6 |
| §7 涉及文件 | Task 1-6 全覆盖 |
| §8 测试 | Task 1 (单测) + Task 7 (回归) |
| §9 范围与不做的事 | 隐含在所有任务的不做声明 |
| §10 验证清单 | Task 7 |

无遗漏。

### 2. Placeholder scan

- ✅ 无 TBD / TODO / "implement later"
- ✅ 无 "Add appropriate error handling" 笼统表述 —— Task 5 第 3/4 步明确写出 Notice 文案与返回路径
- ✅ 测试代码完整（4 个 it 块均给出实际断言）
- ✅ 命令字符串字面量在 Task 1 与 Task 5 复用同一常量
- ✅ 没有 "Similar to Task N"

### 3. Type consistency

- `RunnerHost` 接口在 Task 1 定义,Task 2 实现,Task 5 调用 —— 三处签名一致 (`startOrCreateTab(name: string, command: string, cwd: string): RunnerTab`)。
- `resolveOrCreateTab` 返回 `{ tab: RunnerTab; created: boolean }` —— Task 1 单测断言、Task 2 使用,签名一致。
- `RepairUnresolvedLinksHandler` 类型在 Task 4 定义并 export,Task 3 提前引用 —— 中间状态 lint 会失败（Task 3 步骤已明确说明,留到 Task 4 解决）。
- `REPAIR_UNRESOLVED_LINKS_TAB_NAME` / `REPAIR_UNRESOLVED_LINKS_COMMAND` 在 Task 1 定义、Task 5 使用 —— 常量值在两处都明确给出。

无类型不一致。

---

## 备注

- 全程 6 个 commit + Task 7 不提交（仅验证）。
- 用户偏好：本地提交，不推送。Task 7 报告完成后由用户决定是否 push。
- 上次会话遗留的 `styles.css` 颜色调整（已解析/未解析互换）unstaged；如需要可合并到 Task 6 一起提交,或在 Task 7 报告时提醒用户。