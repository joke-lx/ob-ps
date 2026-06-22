# wli 修复按钮：三态指示器 + 确认弹窗 — 设计

- **日期**：2026-06-22
- **作用域**：`ob-ps` (local-runner) 插件
- **状态**：草案（待复阅）
- **前置**：[2026-06-22-wli-repair-button-design.md](./2026-06-22-wli-repair-button-design.md)

## 背景与目标

第一轮设计为 `wli-section-head` 添加了 wand-2 按钮，点击后通过 `RunnerView` 启动修复未解析双链进程。点击直接触发，没有"二次确认"，启动后也不跳转，用户看不到输出。

本设计在不动状态机编排的前提下，做两件事：
1. **点击后弹 Modal**，说明即将执行什么，让用户**确认**。
2. **按钮变成状态指示器**：根据同名 tab 的运行/退出/未启动显示不同图标，让用户**随时能感知**进程状态；并提供"查看输出"动作跳到 RunnerView（不自动跳，避免抢焦点）。

## 设计决策

| 决策 | 选项 | 选择 |
|---|---|---|
| 进程跳转 | 自动跳 / 弹窗内查看 / 按钮变状态指示器 | **按钮变状态指示器** |
| 指示器语义 | 二态 / 三态 / 图标+小点 | **三态** |
| 三态点击行为 | 都弹 / 未启动弹 / 都弹+分支 | **都弹** |
| 弹窗内容 | 命令+作用 / 作用 / 作用+跳转勾选 | **仅说明 skill 作用** |
| 弹窗按钮 | 两按钮+按状态变文案 / 多按钮按状态分支 | **多按钮按状态分支** |
| 弹窗实现 | 扩展 ConfirmModal / 独立 modal / 不抽 modal | **独立 modal** |

## §1. 架构与边界

新增 2 个独立单元 + 4 处既有文件扩展：

```
src/wikilink-inspector/
├── repair-modal.ts          # NEW — WliRepairConfirmModal + pickModalContent 纯函数
├── repair-modal.test.ts     # NEW — pickModalContent 单测
├── inspector-view.ts        # MODIFIED — 按钮渲染按 status 切换 icon + 轮询刷新
└── ...
src/runner/process-host.ts   # MODIFIED — RunnerHost 加 findTabByCommand
src/view/runner-view.ts      # MODIFIED — 实现 findTabByCommand
main.ts                      # MODIFIED — 加 getRepairTabStatus / revealRunnerTab
styles.css                   # MODIFIED — 状态色 + 旋转动画
```

`WliRepairConfirmModal` 单职责：根据 `RepairTabStatus` 渲染不同标题/文案/按钮，回调给调用方。**不持有** `RunnerView` 引用。Modal 内容由纯函数 `pickModalContent(status)` 决策，Modal 只是渲染该函数的输出 —— 便于单测覆盖三态分支。

`InspectorViewOptions` 扩展为：

```ts
export interface InspectorViewOptions {
  onOpenRunner: () => void;
  /** 查询修复 tab 当前状态(供按钮图标与弹窗使用) */
  getRepairTabStatus: () => RepairTabStatus;
  /** 点击"查看输出"时调用:跳到 RunnerView 并定位修复 tab */
  revealRunnerTab: () => void;
  /** 点击"启动"或"重启"时调用 */
  onRepairUnresolvedLinks: (opts: { jumpToRunner: boolean }) => Promise<void>;
}
```

`RunnerHost` 接口扩展：

```ts
export interface RunnerHost {
  startOrCreateTab(name: string, command: string, cwd: string): RunnerTab;
  /** 按 command 查找 tab(供状态查询);不存在返回 null */
  findTabByCommand(command: string): RunnerTab | null;
}
```

## §2. 数据流

### 2.1 按钮点击 → 弹窗

```
[click] .wli-section-action (key=unresolved)
   │
   ▼
WikilinkInspectorView.onRepairBtnClick()
   │
   ├─ 1) const status = opts.getRepairTabStatus()
   │
   └─ 2) new WliRepairConfirmModal(this.app, status, {
          onLaunch:   () => opts.onRepairUnresolvedLinks({ jumpToRunner: false }),
          onRelaunch: () => opts.onRepairUnresolvedLinks({ jumpToRunner: false }),
          onReveal:   () => opts.revealRunnerTab(),
        }).open()
```

### 2.2 main.ts 编排（onRepairUnresolvedLinks 扩展）

```
1) cwd = getDefaultCwd(); 为空 → Notice + 早退
2) skill 未装 → Notice + openSettings + 早退
3) 开关未开 → 自动开 + saveSettings
4) 拿 RunnerView 实例;失败 → Notice + 早退
5) 如 jumpToRunner → revealLeaf（仅让用户看到 tab 已存在,不在启动前提前跳）
6) view.startOrCreateTab(NAME, COMMAND, cwd)  —— 复用或新建
```

注：reveal 在 startOrCreateTab 之前还是之后是设计选择。**在 startOrCreateTab 之后** 更合理 —— 用户看到的是已存在的 tab 而不是空列表。**修订**：本节按"之后"实现。

## §3. 三态弹窗设计

### 3.1 RepairTabStatus 类型

```ts
export type RepairTabStatus =
  | { kind: "not-exists" }
  | { kind: "running" }
  | { kind: "exited" };
```

> 注：把 `stopped` 与 `exited-ok`/`exited-err` 合并为 `exited` —— 弹窗视角下都是"已结束"，区别是退出码，弹窗不展示。

### 3.2 pickModalContent 纯函数

```ts
export interface ModalContent {
  title: string;
  description: string;
  primary: { label: string };
  secondary: { label: string } | null;
}

export function pickModalContent(status: RepairTabStatus): ModalContent {
  switch (status.kind) {
    case "not-exists":
      return {
        title: "修复未解析双链",
        description: "将扫描仓库内全部未解析双链，由 claude AI 自动补全或创建缺失笔记。",
        primary: { label: "启动" },
        secondary: null,
      };
    case "running":
      return {
        title: "修复未解析双链（运行中）",
        description: "已有进程正在运行。重启将终止当前进程并重新启动。",
        primary: { label: "重启" },
        secondary: { label: "查看输出" },
      };
    case "exited":
      return {
        title: "修复未解析双链（已退出）",
        description: "上次进程已结束。重启将复用同一标签页并重新启动。",
        primary: { label: "重启" },
        secondary: { label: "查看输出" },
      };
  }
}
```

`onLaunch` / `onRelaunch` / `onReveal` 三个回调在 Modal 构造时绑定；按钮点击后调对应回调 + close。

## §4. 按钮状态指示器

### 4.1 三态视觉映射

| kind | 图标 (lucide) | 颜色 | CSS class |
|---|---|---|---|
| `not-exists` | `wand-2` | `--text-muted` | (无) |
| `running` | `loader-2` | `#fbc02d` | `is-running` |
| `exited` | `circle-check` | `--text-faint` | `is-exited` |

### 4.2 CSS

```css
/* 旋转动画(用于 loader-2) */
@keyframes wli-section-action-spin {
  to { transform: rotate(360deg); }
}
.wli-section-action.is-running svg {
  animation: wli-section-action-spin 1.2s linear infinite;
}
.wli-section-action.is-running {
  color: #fbc02d;
}
.wli-section-action.is-exited {
  color: var(--text-faint);
}
```

> 默认 `.wli-section-action` 颜色已定义为 `var(--text-muted)`（继承自第一轮设计），无需重复。

### 4.3 状态轮询

按钮需要反映"启动 → 运行中 → 退出"的状态变化。**机制**：WLI 视图内部 1s 轮询 `getRepairTabStatus`，仅在 `onOpen` 期间轮询，`onClose` 停掉。

```ts
// 伪代码
private statusTimer: number | null = null;

async onOpen(): Promise<void> {
  this.buildUi();
  this.refresh();           // 已有
  this.statusTimer = window.setInterval(() => this.refreshStatusIcon(), 1000);
  this.refreshStatusIcon();
  // ... 既有
}

async onClose(): Promise<void> {
  if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
  if (this.statusTimer !== null) window.clearInterval(this.statusTimer);
}

private refreshStatusIcon(): void {
  const status = this.opts.getRepairTabStatus();
  // 更新未解析 head 的 .wli-section-action 内部 SVG + class
  const actionEl = this.listEl.querySelector(".wli-section.is-unresolved .wli-section-action");
  if (!actionEl) return;
  // 移除 is-running / is-exited,根据 status.kind 重设
  // icon: setIcon(actionEl, ICON_BY_STATUS[status.kind])
}
```

**为什么轮询而不是事件**：
- `startProcess` 内部 `child.on("close", ...)` 是 RunnerView 私有事件，没暴露
- Obsidian 的 `registerEvent` 监听不到子进程事件
- 1s 轮询足够（WLI 视图只是"提示性"显示，用户实际操作频率低）
- 实现简单、生命周期清晰

## §5. 复用同名进程的语义

| 状态 | 弹窗主按钮 | onRelaunch 行为 |
|---|---|---|
| `not-exists` | 启动 | `startOrCreateTab` 创建分支 |
| `running` | 重启 | main.ts 先 stop 同名 tab，再 `startOrCreateTab`（此时 tab 已 stopped 状态，复用分支） |
| `exited` | 重启 | `startOrCreateTab` 复用分支（幂等启动） |

main.ts `onRepairUnresolvedLinks({ jumpToRunner })` 实现：

```ts
async onRepairUnresolvedLinks({ jumpToRunner }: { jumpToRunner: boolean }): Promise<void> {
  // ... 1-4 步骤不变
  if (status.kind === "running") {
    const existing = view.findTabByCommand(REPAIR_UNRESOLVED_LINKS_COMMAND);
    if (existing && isRunning(existing)) {
      stopProcess(existing, () => {});
    }
  }
  view.startOrCreateTab(REPAIR_UNRESOLVED_LINKS_TAB_NAME, REPAIR_UNRESOLVED_LINKS_COMMAND, vault);
  if (jumpToRunner) {
    // 拿到 leaf 并 reveal
  }
}
```

## §6. 错误处理与边界

- `getRepairTabStatus` 抛错 → catch + 视为 `not-exists`
- `revealRunnerTab` 找不到 RunnerView → Notice + 不报错
- `view.startOrCreateTab` spawn 失败 → 已由 startProcess 内部 try/catch 处理；下次轮询看到 `exited`
- 轮询在 view close 时必须清理 timer
- 弹窗打开期间如果 tab 状态变化（极少见）→ 弹窗内容不变（弹窗只读 status 一次）；按钮图标会被轮询更新

## §7. 测试

`repair-modal.test.ts` 覆盖 `pickModalContent` 三个分支：

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

  it("running: 重启 + 查看输出", () => {
    const c = pickModalContent({ kind: "running" });
    expect(c.title).toContain("运行中");
    expect(c.primary.label).toBe("重启");
    expect(c.secondary?.label).toBe("查看输出");
  });

  it("exited: 重启 + 查看输出", () => {
    const c = pickModalContent({ kind: "exited" });
    expect(c.title).toContain("已退出");
    expect(c.primary.label).toBe("重启");
    expect(c.secondary?.label).toBe("查看输出");
  });
});
```

DOM 与 Modal 交互不写单测 —— 由 `obsidian-plugin-review` skill 的人工检查覆盖。

## §8. 涉及文件

| 文件 | 改动 |
|---|---|
| `src/wikilink-inspector/repair-modal.ts` | **新增**：`WliRepairConfirmModal` + `RepairTabStatus` + `pickModalContent` |
| `src/wikilink-inspector/repair-modal.test.ts` | **新增**：3 个分支单测 |
| `src/wikilink-inspector/index.ts` | re-export 新内容 |
| `src/wikilink-inspector/inspector-view.ts` | 按钮渲染按 status 切换 icon；轮询；`onRepairBtnClick` 改为开弹窗 |
| `src/runner/process-host.ts` | `RunnerHost` 加 `findTabByCommand` |
| `src/view/runner-view.ts` | 实现 `findTabByCommand` |
| `main.ts` | `onRepairUnresolvedLinks` 接收 `{ jumpToRunner }`；新增 `getRepairTabStatus` / `revealRunnerTab` 实现；注入三个新回调 |
| `styles.css` | `.is-running` / `.is-exited` 状态色 + 旋转动画 |

## §9. 范围与不做的事

- **不做** 进程退出的实时事件订阅（用 1s 轮询）
- **不做** 把 `revealRunnerTab` 抽象成通用 jump-to-tab 接口（YAGNI）
- **不做** 进程日志预览（用户去 RunnerView 看全量）
- **不改** 现有 `ConfirmModal`（保留删除确认语义）
- **不优化** 轮询频率（1s 是 YAGNI 起点，按需调）
- **不改** `REPAIR_UNRESOLVED_LINKS_*` 常量

## §10. 验证清单

- [ ] `npm run build` 通过
- [ ] `npm run lint` 通过
- [ ] 新增单元测试通过（3 个 pickModalContent 分支）
- [ ] 现有测试不受影响（12/12 保持）
- [ ] 启动 dev, 开启 WLI 视图, 未解析 head 右侧看到 wand-2 图标
- [ ] 点击 → 弹出 Modal 标题"修复未解析双链", 主按钮"启动", 无 secondary
- [ ] 点击"启动" → 1s 内按钮变成 loader-2 旋转图标
- [ ] 再次点击 → Modal 标题含"运行中", 主按钮"重启", secondary"查看输出"
- [ ] 点击"查看输出" → 跳到 RunnerView 并定位修复 tab
- [ ] 进程结束后（手动 stop 或自然退出） → 按钮变成 circle-check
- [ ] 弹窗打开时点击取消 → Modal 关闭, 无任何动作
- [ ] `git status` 干净后 commit + push

## 关系

- 前置：[2026-06-22-wli-repair-button-design.md](./2026-06-22-wli-repair-button-design.md) 已 commit (37e0f1c)
- 后续：进入 writing-plans skill 制定实施计划