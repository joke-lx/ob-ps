# wli 修复按钮：三态指示器 + 确认弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `wli-section-head` 的修复按钮从"直接启动"升级为"点击弹 Modal 确认 + 按钮实时反映进程运行状态（三态图标）+ 弹窗提供查看输出跳转"，并在状态机编排层支持"查看输出"跳转。

**Architecture:** 新增独立 `WliRepairConfirmModal` + 纯函数 `pickModalContent(status)`（按 tab 三态返回标题/文案/按钮）。`RunnerHost` 加 `findTabByCommand` 查询能力。`WikilinkInspectorView` 用 1s 轮询驱动按钮图标切换。`InspectorViewOptions` 扩展三个回调（`getRepairTabStatus` / `revealRunnerTab` / 扩展 `onRepairUnresolvedLinks` 接 `{ jumpToRunner }`）。main.ts 编排层实现这些回调与"运行中重启先 stop 再 start"。

**Tech Stack:** TypeScript + esbuild + Obsidian Plugin API（≥1.7.2），ESM，vitest（纯逻辑单测），eslint（含 `eslint-plugin-obsidianmd`）。

## Global Constraints

- **平台**：仅桌面端（依赖 `child_process`）。
- **Obsidian 版本**：≥ 1.7.2。
- **代码风格**：遵循现有约定——文件 200–400 行、中文注释、Obsidian `createDiv/createSpan/setIcon` DOM 助手、`import type` 用 `import type`。
- **Lint 规则**：`eslint-plugin-obsidianmd` 会拦截 `console.log/info/warn/error` 的自定义前缀（调试用 `console.debug`）。每个任务提交前必须 `npm run lint` 通过。**特别注意 `obsidianmd/ui/sentence-case` 规则**：UI 文案首个可大写词大写、其余小写；专有名词按规则处理（项目实测："local runner" 小写、"Obsidian-repair-unresolved-links" 大写 O 才通过）。
- **构建**：`npm run build` = `tsc -noEmit -skipLibCheck && esbuild --production`，产物为根目录 `main.js`。每个 UI 任务结束前必须 build 通过。
- **测试**：`npm test` 跑 vitest。纯逻辑测试放 `src/**/*.test.ts`，**禁止 import `obsidian`**。
- **提交**：Conventional Commits，每个任务结束提交一次，commit message 末尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`（用两个 `-m`：第一个 message、第二个 trailer）。本计划全程**只本地提交、不推送**（用户会话偏好）。
- **CSS 命名前缀**：新增样式统一用 `wli-` 前缀，与现有 `runner-` 不冲突。
- **已决开放问题**（来自 spec）：
  - 按钮只在 `key === "unresolved"` 的 head 渲染。
  - 三态点击都弹 Modal（不直接跳转）。
  - 弹窗内容仅说明 skill 作用，不显示命令、不加勾选框。
  - 弹窗按钮按状态分支：not-exists → 启动；running/exited → 重启 + 查看输出。
  - 状态刷新用 1s 轮询（不做实时事件订阅）。
  - "重启"语义：running 时先 stop 再 start；exited 直接 start；not-exists 创建+start。

---

## File Structure

| 文件 | 责任 | 新建/修改 |
|------|------|----------|
| `src/wikilink-inspector/repair-modal.ts` | `RepairTabStatus` 类型 + `pickModalContent` 纯函数 + `WliRepairConfirmModal` Modal 类 | 新建 |
| `src/wikilink-inspector/repair-modal.test.ts` | `pickModalContent` 三态单测 | 新建 |
| `src/wikilink-inspector/index.ts` | re-export 新内容 | 修改 |
| `src/runner/process-host.ts` | `RunnerHost` 加 `findTabByCommand` | 修改 |
| `src/runner/index.ts` | 无需改动（`RunnerHost` 已 re-export） | — |
| `src/view/runner-view.ts` | 实现 `findTabByCommand` 公共方法 | 修改 |
| `src/wikilink-inspector/inspector-view.ts` | 按钮按 status 切换 icon + 轮询；`onRepairBtnClick` 改为开弹窗；`onOpen`/`onClose` 加轮询生命周期 | 修改 |
| `main.ts` | `onRepairUnresolvedLinks` 接 `{ jumpToRunner }` + running 时 stop；新增 `getRepairTabStatus` / `revealRunnerTab`；注入三个新回调 | 修改 |
| `styles.css` | `.is-running` / `.is-exited` 状态色 + 旋转动画 | 修改 |

---

## Task 1: `RepairTabStatus` + `pickModalContent` 纯函数（先 TDD）

**Files:**
- Create: `src/wikilink-inspector/repair-modal.ts`
- Create: `src/wikilink-inspector/repair-modal.test.ts`

**Interfaces:**
- Produces:
  - `type RepairTabStatus = { kind: "not-exists" } | { kind: "running" } | { kind: "exited" }`
  - `interface ModalContent { title: string; description: string; primary: { label: string }; secondary: { label: string } | null }`
  - `function pickModalContent(status: RepairTabStatus): ModalContent`

- [ ] **Step 1: 写失败的测试**

Create `src/wikilink-inspector/repair-modal.test.ts`:

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
npm test -- src/wikilink-inspector/repair-modal.test.ts
```
Expected: FAIL，错误信息包含 `Cannot find module './repair-modal'` 或 `pickModalContent is not a function`。

- [ ] **Step 3: 实现 repair-modal.ts 的类型与纯函数**

Create `src/wikilink-inspector/repair-modal.ts`:

```ts
/**
 * 修复未解析双链进程的当前状态(从弹窗视角)。
 * - not-exists: 从未启动,或 tab 被用户删了
 * - running:    进程正在运行
 * - exited:     进程已结束(正常退出 / 异常退出 / 手动停止 统一归此态)
 */
export type RepairTabStatus =
  | { kind: "not-exists" }
  | { kind: "running" }
  | { kind: "exited" };

/** Modal 渲染需要的内容(由纯函数决策,便于单测) */
export interface ModalContent {
  title: string;
  description: string;
  primary: { label: string };
  secondary: { label: string } | null;
}

/**
 * 按进程状态返回弹窗的标题 / 说明 / 按钮文案。
 * 纯函数 —— 不触碰 DOM,便于单测覆盖三态分支。
 */
export function pickModalContent(status: RepairTabStatus): ModalContent {
  switch (status.kind) {
    case "not-exists":
      return {
        title: "修复未解析双链",
        description:
          "将扫描仓库内全部未解析双链,由 claude AI 自动补全或创建缺失笔记。",
        primary: { label: "启动" },
        secondary: null,
      };
    case "running":
      return {
        title: "修复未解析双链(运行中)",
        description: "已有进程正在运行。重启将终止当前进程并重新启动。",
        primary: { label: "重启" },
        secondary: { label: "查看输出" },
      };
    case "exited":
      return {
        title: "修复未解析双链(已退出)",
        description: "上次进程已结束。重启将复用同一标签页并重新启动。",
        primary: { label: "重启" },
        secondary: { label: "查看输出" },
      };
  }
}
```

> 注：本任务只建文件 + 类型 + 纯函数,**还不导入 `obsidian`**。`WliRepairConfirmModal` 在 Task 3 加(那时才会 import `Modal`)。这样 Task 1 的测试可以纯跑,Task 3 才引入 Obsidian 依赖。

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
npm test -- src/wikilink-inspector/repair-modal.test.ts
```
Expected: 4 个测试全部 PASS。

- [ ] **Step 5: lint 验证**

Run:
```bash
npm run lint
```
Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add src/wikilink-inspector/repair-modal.ts src/wikilink-inspector/repair-modal.test.ts
git commit -m "feat(wli): RepairTabStatus 类型与 pickModalContent 纯函数" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `RunnerHost.findTabByCommand` 查询能力

**Files:**
- Modify: `src/runner/process-host.ts`（`RunnerHost` 接口加方法）
- Modify: `src/view/runner-view.ts`（实现该方法）

**Interfaces:**
- Consumes: `RunnerTab` from `./process-model` (已 import)
- Produces: `RunnerHost.findTabByCommand(command: string): RunnerTab | null` —— 在 `RunnerView` 上实现为公共方法

- [ ] **Step 1: 扩展 `RunnerHost` 接口**

Modify `src/runner/process-host.ts`，把：

```ts
export interface RunnerHost {
  /**
   * 若 command 已存在则复用并启动;否则新建标签页并启动。
   * 不切换视图、不弹出 UI。
   */
  startOrCreateTab(name: string, command: string, cwd: string): RunnerTab;
}
```

改为：

```ts
export interface RunnerHost {
  /**
   * 若 command 已存在则复用并启动;否则新建标签页并启动。
   * 不切换视图、不弹出 UI。
   */
  startOrCreateTab(name: string, command: string, cwd: string): RunnerTab;

  /**
   * 按 command 查找已有标签页;不存在返回 null。
   * 供状态查询使用(按钮图标 + 弹窗),不修改任何 tab。
   */
  findTabByCommand(command: string): RunnerTab | null;
}
```

- [ ] **Step 2: 在 `RunnerView` 实现 `findTabByCommand`**

Modify `src/view/runner-view.ts`。定位已有的 `startOrCreateTab` 公共方法(由前一轮 Task 2 添加,位于 `setTabsFromConfigs` 之后)。在 `startOrCreateTab` 方法**之后**、`// ---- UI Build ----` 注释**之前**插入：

```ts
  /** Host 接口实现:按 command 查找标签页;不存在返回 null */
  findTabByCommand(command: string): RunnerTab | null {
    return this.tabs.find((t) => t.command === command) ?? null;
  }
```

- [ ] **Step 3: build 与 lint 验证**

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

- [ ] **Step 4: 跑全量测试确认未回归**

Run:
```bash
npm test
```
Expected: 全部已有测试 PASS(无回归)。

- [ ] **Step 5: Commit**

```bash
git add src/runner/process-host.ts src/view/runner-view.ts
git commit -m "feat(runner): RunnerHost 加 findTabByCommand 查询能力" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `WliRepairConfirmModal` 类

**Files:**
- Modify: `src/wikilink-inspector/repair-modal.ts`（追加 Modal 类）
- Modify: `src/wikilink-inspector/index.ts`（re-export）

**Interfaces:**
- Consumes: `RepairTabStatus`、`ModalContent`、`pickModalContent` from Task 1；`Modal` from `obsidian`
- Produces: `class WliRepairConfirmModal extends Modal` + 重新导出全部公共 API

- [ ] **Step 1: 在 repair-modal.ts 顶部 import `Modal`**

Modify `src/wikilink-inspector/repair-modal.ts`，在文件**最顶部**(类型定义之前)追加：

```ts
import { Modal } from "obsidian";
```

- [ ] **Step 2: 在文件末尾追加 Modal 类**

在 `src/wikilink-inspector/repair-modal.ts` 末尾(`pickModalContent` 函数之后)追加：

```ts

/** 弹窗回调 —— 由调用方(WLI 视图)注入,决定按钮点击后做什么 */
export interface RepairModalCallbacks {
  /** 主按钮点击:启动或重启进程 */
  onLaunch: () => void;
  /** 次要按钮点击(仅 running/exited):跳到 RunnerView 查看输出 */
  onReveal?: () => void;
}

/**
 * 修复未解析双链的确认弹窗。
 * 根据 tab 状态渲染不同标题/文案/按钮,按钮点击后调对应回调并关闭。
 */
export class WliRepairConfirmModal extends Modal {
  private readonly status: RepairTabStatus;
  private readonly callbacks: RepairModalCallbacks;

  constructor(
    app: import("obsidian").App,
    status: RepairTabStatus,
    callbacks: RepairModalCallbacks,
  ) {
    super(app);
    this.status = status;
    this.callbacks = callbacks;
  }

  onOpen(): void {
    const content = pickModalContent(this.status);

    this.titleEl.setText(content.title);
    this.contentEl.createEl("p", {
      cls: "wli-repair-desc",
      text: content.description,
    });

    const actions = this.contentEl.createDiv({ cls: "wli-repair-actions" });

    // 次要按钮(查看输出) —— 仅 running/exited 显示
    if (content.secondary) {
      const revealBtn = actions.createEl("button", {
        text: content.secondary.label,
      });
      revealBtn.addEventListener("click", () => {
        this.callbacks.onReveal?.();
        this.close();
      });
    }

    // 主按钮(启动 / 重启)
    const primaryBtn = actions.createEl("button", {
      cls: "mod-cta",
      text: content.primary.label,
    });
    primaryBtn.addEventListener("click", () => {
      this.callbacks.onLaunch();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
```

- [ ] **Step 3: 在 index.ts re-export**

Modify `src/wikilink-inspector/index.ts`。在文件**末尾**追加：

```ts
export {
  type RepairTabStatus,
  type ModalContent,
  type RepairModalCallbacks,
  pickModalContent,
  WliRepairConfirmModal,
} from "./repair-modal";
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

> 若 lint 报 `obsidianmd/ui/sentence-case` —— 检查 Task 1 的 description/title 文案;实测"修复未解析双链(运行中)""将扫描仓库内全部未解析双链,由 claude AI 自动补全或创建缺失笔记。"应能通过(中文为主)。若仍报错,把首个英文词首字母大写(如 "Claude")。

- [ ] **Step 5: 跑全量测试**

Run:
```bash
npm test
```
Expected: 全部 PASS(Task 1 的 4 个 + 既有 12 个 = 16)。

- [ ] **Step 6: Commit**

```bash
git add src/wikilink-inspector/repair-modal.ts src/wikilink-inspector/index.ts
git commit -m "feat(wli): WliRepairConfirmModal 三态确认弹窗" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: CSS 状态色与旋转动画

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: 添加状态色与动画规则**

定位 `styles.css` 中已有的 `.wli-section-action:disabled { ... }` 规则块(由前一轮 Task 6 添加)。在该规则块**之后**(`.wli-section-action:disabled { ... }` 的闭合 `}` 之后、`/* 状态色点（绿=已解析，蓝=未解析，与笔记内高亮一致） */` 注释之前)插入：

```css

/* 三态指示器 —— 运行中(黄色 + 旋转) / 已退出(灰) */
@keyframes wli-section-action-spin {
  to { transform: rotate(360deg); }
}
.wli-section-action.is-running {
  color: #fbc02d;
}
.wli-section-action.is-running svg {
  animation: wli-section-action-spin 1.2s linear infinite;
}
.wli-section-action.is-exited {
  color: var(--text-faint);
}

/* 弹窗:说明文字 + 按钮行 */
.wli-repair-desc {
  margin: 0 0 16px;
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  line-height: 1.5;
}
.wli-repair-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
```

- [ ] **Step 2: lint 验证**

Run:
```bash
npm run lint
```
Expected: 无错误(CSS 不参与 lint,但保险起见跑一遍)。

- [ ] **Step 3: build 验证(esbuild 会处理 CSS)**

Run:
```bash
npm run build
```
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add styles.css
git commit -m "style(wli): 修复按钮三态指示器与弹窗样式" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: main.ts 编排扩展（getRepairTabStatus / revealRunnerTab / onRepairUnresolvedLinks 带 jumpToRunner + running 重启先 stop）

**Files:**
- Modify: `main.ts`

**Interfaces:**
- Consumes: `RunnerHost.findTabByCommand`、`isRunning`、`stopProcess`、`RunnerView`、`REPAIR_UNRESOLVED_LINKS_COMMAND`、`RepairTabStatus`
- Produces:
  - `LocalRunnerPlugin.onRepairUnresolvedLinks(opts: { jumpToRunner: boolean }): Promise<void>`
  - `private LocalRunnerPlugin.getRepairTabStatus(): RepairTabStatus`
  - `private LocalRunnerPlugin.revealRunnerTab(): void`
  - 注入 WLI 视图注册的三个回调

- [ ] **Step 1: 扩展 import**

Modify `main.ts`。定位顶部 import 块,把：

```ts
import {
  REPAIR_UNRESOLVED_LINKS_COMMAND,
  REPAIR_UNRESOLVED_LINKS_TAB_NAME,
} from "./src/runner";
```

改为：

```ts
import {
  REPAIR_UNRESOLVED_LINKS_COMMAND,
  REPAIR_UNRESOLVED_LINKS_TAB_NAME,
  isRunning,
  stopProcess,
  type RunnerTab,
} from "./src/runner";
```

并在文件顶部已有的 wikilink-inspector import 块中扩展 `RepairTabStatus`。定位：

```ts
import {
  WIKILINK_INSPECTOR_VIEW_TYPE,
  WikilinkInspectorView,
  type InspectorViewOptions,
} from "./src/wikilink-inspector";
```

改为：

```ts
import {
  WIKILINK_INSPECTOR_VIEW_TYPE,
  WikilinkInspectorView,
  type InspectorViewOptions,
  type RepairTabStatus,
} from "./src/wikilink-inspector";
```

> 注意:`RepairTabStatus` 在 Task 6 才会被 `index.ts` re-export。本步骤改 main.ts 的 import 会因找不到该 export 而 **tsc 暂时失败** —— 这是预期的(Task 3 已 re-export,Task 6 才 re-export `RepairTabStatus`;**本步骤依赖 Task 6 完成**)。
>
> **执行顺序调整**:实际执行时,Task 5 与 Task 6 的 re-export 存在循环依赖。**解决方案**:把 Task 6 Step 2(在 index.ts re-export `RepairTabStatus`)提前到 Task 5 Step 1 之前执行。即:本任务开始前,先手动在 `src/wikilink-inspector/index.ts` 末尾加 `export type { RepairTabStatus } from "./repair-modal";`。Task 6 再补齐其余 re-export。

- [ ] **Step 2: 改 `onRepairUnresolvedLinks` 签名与重启逻辑**

定位 `main.ts` 中已有的 `onRepairUnresolvedLinks()` 方法(由前一轮 Task 5 添加)。把整个方法：

```ts
  async onRepairUnresolvedLinks(): Promise<void> {
    const vault = this.getDefaultCwd();
    if (!vault) {
      new Notice("无法获取 vault 路径");
      return;
    }

    // 1) 磁盘实际未安装 → 引导去设置页, 不启动
    if (!isSkillInstalled(vault)) {
      new Notice(
        "请先在「设置 → local runner」安装 Obsidian-repair-unresolved-links skill",
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
```

替换为：

```ts
  /**
   * 编排「修复未解析双链」流程:skill 开关自洽 → 拿到 RunnerView → 启动进程。
   * running 状态下重启会先 stop 同名 tab 再 start。
   * jumpToRunner=true 时启动后 revealLeaf 跳到 RunnerView。
   */
  async onRepairUnresolvedLinks({
    jumpToRunner,
  }: {
    jumpToRunner: boolean;
  }): Promise<void> {
    const vault = this.getDefaultCwd();
    if (!vault) {
      new Notice("无法获取 vault 路径");
      return;
    }

    // 1) 磁盘实际未安装 → 引导去设置页, 不启动
    if (!isSkillInstalled(vault)) {
      new Notice(
        "请先在「设置 → local runner」安装 Obsidian-repair-unresolved-links skill",
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

    // 4) running 状态下重启 → 先 stop 同名 tab
    const existing = view.findTabByCommand(REPAIR_UNRESOLVED_LINKS_COMMAND);
    if (existing && isRunning(existing)) {
      stopProcess(existing, () => {});
    }

    // 5) 启动 (复用同名 或 新建)
    view.startOrCreateTab(
      REPAIR_UNRESOLVED_LINKS_TAB_NAME,
      REPAIR_UNRESOLVED_LINKS_COMMAND,
      vault,
    );

    // 6) 按需跳转到 RunnerView
    if (jumpToRunner) {
      this.revealRunnerTab();
    }
  }

  /** 查询修复 tab 当前状态 —— 供 WLI 视图按钮图标 + 弹窗使用 */
  private getRepairTabStatus(): RepairTabStatus {
    const leaf = this.app.workspace.getLeavesOfType(RUNNER_VIEW_TYPE)[0];
    const view = leaf?.view;
    if (!(view instanceof RunnerView)) {
      return { kind: "not-exists" };
    }
    const tab = view.findTabByCommand(REPAIR_UNRESOLVED_LINKS_COMMAND);
    if (!tab) {
      return { kind: "not-exists" };
    }
    return isRunning(tab) ? { kind: "running" } : { kind: "exited" };
  }

  /** 跳到 RunnerView 并定位修复 tab(展开它) */
  private revealRunnerTab(): void {
    const leaf = this.app.workspace.getLeavesOfType(RUNNER_VIEW_TYPE)[0];
    if (!leaf) {
      new Notice("本地进程视图未就绪");
      return;
    }
    void this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof RunnerView) {
      const tab = view.findTabByCommand(REPAIR_UNRESOLVED_LINKS_COMMAND);
      if (tab) {
        // RunnerView 未暴露 expand 公共方法;通过 setExpanded 系列内部状态无法直接访问。
        // 折中:revealLeaf 已把 RunnerView 置于前台,用户可手动展开。
        // (避免为单次跳转新增公共 API —— YAGNI)
      }
    }
  }
```

> 注意 `revealRunnerTab` 的"展开 tab"被有意省略 —— `RunnerView` 的 `expandedIds` 是私有。展开能力不是本任务必需(revealLeaf 已让用户看到列表)。**若 review 强烈要求展开**,在 Task 7 补一个 `RunnerView.expandTab(id)` 公共方法。本计划保持不展开。

- [ ] **Step 3: 注入三个新回调到 WLI 视图注册**

定位 `main.ts` 中 `registerView(WIKILINK_INSPECTOR_VIEW_TYPE, ...)` 调用。把：

```ts
    this.registerView(WIKILINK_INSPECTOR_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      const opts: InspectorViewOptions = {
        onOpenRunner: () => void this.activateView(),
        onRepairUnresolvedLinks: () => this.onRepairUnresolvedLinks(),
      };
      return new WikilinkInspectorView(leaf, opts);
    });
```

替换为：

```ts
    this.registerView(WIKILINK_INSPECTOR_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      const opts: InspectorViewOptions = {
        onOpenRunner: () => void this.activateView(),
        getRepairTabStatus: () => this.getRepairTabStatus(),
        revealRunnerTab: () => this.revealRunnerTab(),
        onRepairUnresolvedLinks: ({ jumpToRunner }) =>
          void this.onRepairUnresolvedLinks({ jumpToRunner }),
      };
      return new WikilinkInspectorView(leaf, opts);
    });
```

- [ ] **Step 4: build 与 lint 验证**

Run:
```bash
npm run build
```
Expected: 通过(此时 `InspectorViewOptions` 还没扩展 `getRepairTabStatus` / `revealRunnerTab` 字段 —— **tsc 会报类型不匹配**)。
**这是预期的失败** —— Task 6 会扩展 `InspectorViewOptions`。本步骤**不提交**,进入 Task 6。

> 执行顺序:Task 5 与 Task 6 互相依赖(Task 5 用 Task 6 的类型,Task 6 用 Task 5 的回调)。**实际执行时把 Task 5 与 Task 6 合并为一个 commit**(见 Task 6 末尾的合并提交说明),或先做 Task 6 的类型扩展再做 Task 5。本计划按"先 Task 5 改 main.ts(允许 tsc 临时红),再 Task 6 改视图(同时 fix 类型),合并提交"的顺序。

- [ ] **Step 5: (不提交,留待 Task 6 合并)**

---

## Task 6: WLI 视图扩展（按钮三态图标 + 轮询 + 开弹窗 + InspectorViewOptions 扩展）

**Files:**
- Modify: `src/wikilink-inspector/index.ts`（re-export `RepairTabStatus`，若 Task 5 未提前做）
- Modify: `src/wikilink-inspector/inspector-view.ts`（核心改动）

**Interfaces:**
- Consumes: `WliRepairConfirmModal`、`RepairTabStatus`、`pickModalContent`(隐式,Modal 内部用) from `./repair-modal`
- Produces: 扩展后的 `InspectorViewOptions`(三个回调字段);按钮按 status 切换 icon;`onRepairBtnClick` 开弹窗;`onOpen`/`onClose` 加轮询

- [ ] **Step 1: 在 index.ts re-export `RepairTabStatus`（若 Task 5 Step 1 未提前做）**

若 `src/wikilink-inspector/index.ts` 末尾还没有 `RepairTabStatus` 的 re-export,追加(Task 3 已 re-export 其余,这里补 `RepairTabStatus` 如果 Task 3 漏了):

```ts
export type { RepairTabStatus } from "./repair-modal";
```

> Task 3 的 re-export 块已包含 `RepairTabStatus`,此步通常无需操作。仅当 tsc 报 `Module ... has no exported member 'RepairTabStatus'` 时执行。

- [ ] **Step 2: 扩展 `InspectorViewOptions` 接口**

Modify `src/wikilink-inspector/inspector-view.ts`。定位(文件顶部 ~15 行):

```ts
/** 视图构造参数：onOpenRunner 由 main.ts 绑定到 activateView() */
export interface InspectorViewOptions {
  onOpenRunner: () => void;
  /** 点击「修复未解析双链」按钮时触发;由 main.ts 实现 */
  onRepairUnresolvedLinks?: RepairUnresolvedLinksHandler;
}

/** 修复未解析双链按钮的点击处理 —— 由 main.ts 注入 */
export type RepairUnresolvedLinksHandler = () => void | Promise<void>;
```

替换为：

```ts
/** 视图构造参数：由 main.ts 绑定各回调 */
export interface InspectorViewOptions {
  onOpenRunner: () => void;
  /** 查询修复 tab 当前状态(供按钮图标与弹窗使用) */
  getRepairTabStatus: () => RepairTabStatus;
  /** 点击"查看输出"时调用:跳到 RunnerView 并定位修复 tab */
  revealRunnerTab: () => void;
  /** 点击"启动"或"重启"时调用;jumpToRunner=true 时启动后跳转 */
  onRepairUnresolvedLinks: (opts: {
    jumpToRunner: boolean;
  }) => void | Promise<void>;
}
```

(移除旧的 `RepairUnresolvedLinksHandler` 类型 —— 它已被内联到接口签名。)

- [ ] **Step 3: import `RepairTabStatus` 与 `WliRepairConfirmModal`**

Modify `src/wikilink-inspector/inspector-view.ts`。定位顶部 import,在 `import { flattenWikilinks } from "./flatten-links";` **之后**追加：

```ts
import {
  WliRepairConfirmModal,
  type RepairTabStatus,
} from "./repair-modal";
```

- [ ] **Step 4: 加轮询常量与状态映射**

在 `const DEFAULT_PREVIEW = 5;` 与 `const REFRESH_DEBOUNCE_MS = 400;` **之后**追加：

```ts
/** 按钮状态轮询间隔(ms) —— 反映进程 running/exited 变化 */
const STATUS_POLL_MS = 1000;

/** 三态对应的 lucide 图标名 */
const STATUS_ICON: Record<RepairTabStatus["kind"], string> = {
  "not-exists": "wand-2",
  running: "loader-2",
  exited: "circle-check",
};
```

- [ ] **Step 5: 在 `WikilinkInspectorView` 类加 statusTimer 字段**

定位类的私有字段区(约 `private debounceTimer: number | null = null;` 附近)。在该字段**之后**追加：

```ts
  /** 按钮状态轮询 timer(仅 onOpen 期间运行) */
  private statusTimer: number | null = null;
```

- [ ] **Step 6: 在 `onOpen` 启动轮询**

定位 `async onOpen(): Promise<void> {`。把：

```ts
  async onOpen(): Promise<void> {
    this.buildUi();
    this.refresh();
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => this.scheduleRefresh()),
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.scheduleRefresh()),
    );
  }
```

替换为：

```ts
  async onOpen(): Promise<void> {
    this.buildUi();
    this.refresh();
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => this.scheduleRefresh()),
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.scheduleRefresh()),
    );
    // 启动按钮状态轮询
    this.refreshStatusIcon();
    this.statusTimer = window.setInterval(
      () => this.refreshStatusIcon(),
      STATUS_POLL_MS,
    );
  }
```

- [ ] **Step 7: 在 `onClose` 清理 timer**

定位 `async onClose(): Promise<void> {`。把：

```ts
  async onClose(): Promise<void> {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
  }
```

替换为：

```ts
  async onClose(): Promise<void> {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    if (this.statusTimer !== null) {
      window.clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }
```

- [ ] **Step 8: 添加 `refreshStatusIcon` 私有方法**

定位 `onRepairBtnClick` 方法(类内,约 234 行)。在 `onRepairBtnClick` **之前**插入：

```ts
  /** 刷新未解析 head 上修复按钮的图标与状态 class */
  private refreshStatusIcon(): void {
    const actionEl = this.contentEl.querySelector<HTMLElement>(
      ".wli-section.is-unresolved .wli-section-action",
    );
    if (!actionEl) return;
    const status = this.opts.getRepairTabStatus();
    setIcon(actionEl, STATUS_ICON[status.kind]);
    actionEl.removeClass("is-running", "is-exited");
    if (status.kind === "running") actionEl.addClass("is-running");
    else if (status.kind === "exited") actionEl.addClass("is-exited");
  }
```

- [ ] **Step 9: 改 `onRepairBtnClick` 为开弹窗**

把现有的 `onRepairBtnClick`：

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

替换为：

```ts
  /** 修复按钮点击 —— 开确认弹窗,按 tab 状态分支 */
  private onRepairBtnClick(): void {
    const status = this.opts.getRepairTabStatus();
    new WliRepairConfirmModal(this.app, status, {
      onLaunch: () => {
        void this.opts.onRepairUnresolvedLinks({ jumpToRunner: false });
      },
      onReveal: () => this.opts.revealRunnerTab(),
    }).open();
  }
```

- [ ] **Step 10: 改按钮渲染(移除 `onRepairUnresolvedLinks` 守卫,改为始终渲染)**

定位 `renderSection` 中按钮创建块(约 192 行)。把：

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

替换为(移除 `&& this.opts.onRepairUnresolvedLinks` 守卫,因为接口已改为必填):

```ts
    // 修复未解析双链按钮 —— 仅在 unresolved 分组显示
    if (key === "unresolved") {
      const action = head.createDiv({
        cls: "wli-section-action",
        title: "修复未解析双链",
        attr: { "aria-label": "修复未解析双链" },
      });
      setIcon(action, STATUS_ICON["not-exists"]);
      action.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onRepairBtnClick();
      });
    }
```

> 注意:初始渲染用 `STATUS_ICON["not-exists"]`(`wand-2`);`onOpen` 中的 `refreshStatusIcon()` 会立即校正为真实状态。STATUS_ICON 在 Step 4 已定义。

- [ ] **Step 11: build 与 lint 验证**

Run:
```bash
npm run build
```
Expected: 通过(此时 Task 5 的 main.ts 改动 + 本任务的类型扩展应已互相满足)。

Run:
```bash
npm run lint
```
Expected: 无错误。

- [ ] **Step 12: 跑全量测试**

Run:
```bash
npm test
```
Expected: 全部 PASS。

- [ ] **Step 13: 合并提交 Task 5 + Task 6**

Task 5 与 Task 6 互相依赖,合并为一个 commit:

```bash
git add main.ts src/wikilink-inspector/inspector-view.ts src/wikilink-inspector/index.ts
git commit -m "feat(wli): 按钮三态指示器 + 确认弹窗编排" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 集成验证 + 收尾

**Files:**
- 不修改新文件,只跑命令 + 手动验证

- [ ] **Step 1: 跑全量测试**

Run:
```bash
npm test
```
Expected: 全部 PASS(16 个:既有 12 + Task 1 新增 4)。

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

依次在 Obsidian 中验证(启动 `npm run dev` 加载插件):
- [ ] 启用「双链检查」侧边栏
- [ ] 未解析分组 head 右侧初始为 wand-2 图标(not-exists)
- [ ] 点击 → 弹出 Modal,标题"修复未解析双链",主按钮"启动",无 secondary
- [ ] 点"启动" → 1s 内按钮变成 loader-2 旋转图标(running)
- [ ] 再次点击 → Modal 标题含"运行中",主按钮"重启",secondary"查看输出"
- [ ] 点"查看输出" → 跳到 RunnerView(revealLeaf)
- [ ] 点"重启" → 原进程 stop + 新进程 start(可看到 RunnerView 中 tab 重启)
- [ ] 进程结束后(手动 stop 或自然退出) → 1s 内按钮变成 circle-check(exited)
- [ ] 点击 circle-check → Modal 标题含"已退出",主按钮"重启",secondary"查看输出"
- [ ] 点 Modal 外或取消(Esc) → Modal 关闭,无任何动作
- [ ] 点击按钮不触发 head 的折叠切换(stopPropagation 生效)
- [ ] 已解析分组 head 不显示按钮

- [ ] **Step 5: 检查 git status 干净**

Run:
```bash
git status
```
Expected: 无未提交修改。

- [ ] **Step 6: 总结报告**

向用户报告:所有任务完成,build / lint / test 全通过,等待用户验收 + 决定是否推送。

---

## Self-Review

### 1. Spec coverage

| Spec 节 | 对应任务 |
|---|---|
| §1 架构与边界 | Task 1-6 全覆盖 |
| §2 数据流(点击→弹窗) | Task 6 Step 9 |
| §2 数据流(main.ts 编排扩展) | Task 5 |
| §3 三态弹窗(pickModalContent) | Task 1 + Task 3 |
| §4 按钮状态指示器(三态图标) | Task 6 Step 8/10 |
| §4 轮询机制 | Task 6 Step 6/7 |
| §5 复用语义(running 先 stop) | Task 5 Step 2 |
| §6 错误处理与边界 | Task 5(getRepairTabStatus 找不到 view → not-exists;revealRunnerTab 找不到 → Notice) |
| §7 测试 | Task 1 单测 + Task 7 回归 |
| §8 涉及文件 | Task 1-6 |
| §9 范围与不做 | 隐含(reveal 不展开 tab = YAGNI) |
| §10 验证清单 | Task 7 |

无遗漏。

### 2. Placeholder scan

- ✅ 无 TBD / TODO / "implement later"
- ✅ 无 "Add appropriate error handling" —— 所有错误路径都有明确 Notice + return
- ✅ 测试代码完整(4 个 it 块)
- ✅ 没有 "Similar to Task N"
- ✅ Task 5 Step 2 的 `revealRunnerTab` 注释解释了为什么不展开 tab(不是占位符,是设计决策)

### 3. Type consistency

- `RepairTabStatus` 在 Task 1 定义,Task 5 / Task 6 使用 —— 三处 `kind` 字面量一致(`not-exists` / `running` / `exited`)。
- `pickModalContent` 返回 `ModalContent` —— Task 1 定义,Task 3 Modal 内部使用,签名一致。
- `RunnerHost.findTabByCommand` 在 Task 2 定义,Task 5 使用 —— 签名一致 `(command: string): RunnerTab | null`。
- `InspectorViewOptions` 在 Task 6 扩展,Task 5 main.ts 注入 —— 三个回调签名一致:
  - `getRepairTabStatus: () => RepairTabStatus`
  - `revealRunnerTab: () => void`
  - `onRepairUnresolvedLinks: (opts: { jumpToRunner: boolean }) => void | Promise<void>`
- `WliRepairConfirmModal` 构造签名 Task 3 定义 `(app, status, callbacks)`,Task 6 使用 —— 一致。
- `RepairModalCallbacks` Task 3 定义 `{ onLaunch: () => void; onReveal?: () => void }`,Task 6 传入 —— 一致。
- `STATUS_ICON` Task 6 Step 4 定义,Step 8/10 使用 —— key 是 `RepairTabStatus["kind"]`,一致。

无类型不一致。

### 4. 任务依赖与执行顺序备注

- **Task 5 ↔ Task 6 互相依赖**:Task 5 用 Task 6 的 `InspectorViewOptions` 扩展,Task 6 用 Task 5 的 main.ts 回调。计划已说明:**合并为 Task 6 Step 13 一个 commit**;执行时先做 Task 5(允许 tsc 临时红),再做 Task 6(tsc 同时变绿),最后合并提交。
- **Task 3 re-export 是否含 `RepairTabStatus`**:Task 3 Step 3 的 re-export 块**已包含** `type RepairTabStatus`。Task 5 Step 1 import 它时不会报错(Task 3 先于 Task 5 完成)。Task 6 Step 1 是防御性检查,通常无需操作。

---

## 备注

- 全程 6 个 commit(Task 1, 2, 3, 4, 5+6 合并) + Task 7 不提交(仅验证)。
- 用户偏好:本地提交,不推送。Task 7 报告完成后由用户决定是否 push。
- 与第一轮(2026-06-22-wli-repair-button)的关系:本计划**扩展**第一轮的 `RunnerHost` 与 `onRepairUnresolvedLinks`,不替换。第一轮的 9 个 commit 已在 `joke` 分支。
