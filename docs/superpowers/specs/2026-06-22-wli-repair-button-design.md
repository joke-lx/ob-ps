# wli-section-head 修复未解析双链按钮 — 设计

- **日期**：2026-06-22
- **作用域**：`ob-ps` (local-runner) 插件
- **状态**：草案（待复阅）

## 背景与目标

Wikilink Inspector 视图侧边栏把仓库里的双链分为"已解析 / 未解析"两组展示。现有 `wli-action-bar` 已有"清除双链"按钮，把当前打开笔记的双链转为单链；缺少的是"从仓库级批量修复未解析"动作。

`obsidian-repair-unresolved-links` skill 已通过 `ZHLX2005/sl` 仓库安装到 vault 的 `.claude/skills/` 目录中，提供一个 `/obsidian-repair-unresolved-links` slash 命令触发批量修复。本设计的目标：在 `wli-section-head` 的"未解析"分组头部右侧加一个按钮，让用户一键触发该 skill 的批量修复。

## 设计决策

| 决策 | 选项 | 选择 |
|---|---|---|
| 开关未开时的行为 | A 自动开并启动 / B 自动开 + 缺失时引导安装 / C 硬阻挡 | **B** |
| 按钮位置 | 只放未解析区 / 两处都放 | **只放未解析区** |
| 启动后是否跳到 RunnerView | A 跳转 / B 不跳转 | **B 不跳转** |
| 重复点击策略 | A 复用同名进程 / B 始终新建 | **A 复用同名进程** |
| 实现路径 | 2 main.ts 编排 / 3 RunnerHost 抽象 | **3 RunnerHost 抽象** |

## §1. 架构与边界

新增最小契约 `RunnerHost`，独立于两个视图，避免 `WikilinkInspectorView` 直接 import `RunnerView` 形成视图层耦合。

```ts
// src/runner/process-host.ts

/** 进程标签页的「启动或创建」最小能力 —— 由 RunnerView 实现 */
export interface RunnerHost {
  /**
   * 若 command 已存在则复用并启动;否则新建标签页并启动。
   * 不切换视图、不弹出 UI。
   */
  startOrCreateTab(name: string, command: string, cwd: string): RunnerTab;
}
```

`RunnerView` 实现该 host。新增公共方法 `RunnerView.startOrCreateTab` —— 内部委托纯函数 `resolveOrCreateTab(tabs, name, command, cwd)` 处理查找与新建（保证可单测），再调 `startProcess` + `saveConfigs`。

`WikilinkInspectorView` 不直接持有 host。其 `InspectorViewOptions` 增加一个可选回调：

```ts
export interface InspectorViewOptions {
  onOpenRunner: () => void;
  /** 点击「修复未解析双链」按钮时触发;由 main.ts 实现 */
  onRepairUnresolvedLinks?: () => void | Promise<void>;
}
```

`main.ts` 在 `registerView(WIKILINK_INSPECTOR_VIEW_TYPE, ...)` 中注入实现 `onRepairUnresolvedLinks` 的编排方法。

## §2. 数据流

一次按钮点击的完整链路：

```
[click] .wli-section-action (only on key="unresolved")
   │ e.stopPropagation() 阻止冒泡触发 head 折叠
   ▼
WikilinkInspectorView.onRepairBtnClick()
   │ 调 opts.onRepairUnresolvedLinks()
   ▼
main.ts.LocalRunnerPlugin.onRepairUnresolvedLinks()
   │
   ├─ 1) cwd = this.getDefaultCwd()
   │     若为空 → Notice("无法获取 vault 路径") + 早退
   │
   ├─ 2) const skillOnDisk = isSkillInstalled(cwd)
   │     ├─ false → Notice 引导去设置页安装 skill
   │     │           + openSettings()  (打开设置页, 不切视图)
   │     │           早退
   │     └─ true → 继续
   │
   ├─ 3) 若 settings.repairLinksSkillInstalled === false
   │     ├─ settings.repairLinksSkillInstalled = true
   │     └─ await this.saveSettings()
   │
   ├─ 4) 拿到 RunnerView 实例(必要时激活+等待 onOpen)
   │     const view = this.getOrActivateRunnerView()
   │     (实现: 先 workspace.getLeavesOfType, 没有则 activateView() 后
   │      await leaf.setViewState 完成 → 取 view 字段)
   │
   └─ 5) view.startOrCreateTab(NAME, COMMAND, cwd)
            └─ 内部:复用同名 或 createTab+push+startProcess
```

`getOrActivateRunnerView` 是新增的私有方法，处理"RunnerView 可能尚未实例化"的边界。

## §3. Skill 开关自洽逻辑

复用 `src/skills/repair-links.ts` 的 `isSkillInstalled(vault)`。状态矩阵：

| 磁盘已安装 | 开关状态 | 行为 |
|---|---|---|
| ✅ | ✅ | 直接走启动链路 |
| ✅ | ❌ | 自动置 `true`、落盘（`saveSettings`），再走启动链路 |
| ❌ | ✅ | 极少见（`reconcileInstalledFlag` 启动时已校正）。不特别处理，让进程正常启动、由 claude 自身报错 |
| ❌ | ❌ | Notice 引导去设置页安装；不启动 |

引导安装的 Notice 文案：`"请先在「设置 → Local Runner」安装 obsidian-repair-unresolved-links skill"`，随后调 `openSettings()`（仅 `app.setting.open()` + `openTabById`，不切换视图）。

## §4. 命令与标签页常量

```ts
// src/runner/process-host.ts
export const REPAIR_UNRESOLVED_LINKS_TAB_NAME = "修复未解析双链";
export const REPAIR_UNRESOLVED_LINKS_COMMAND =
  'claude --dangerously-skip-permissions -p "/obsidian-repair-unresolved-links"';
```

`cwd` 永远使用 `Plugin.getDefaultCwd()` 拿到的 vault 根目录,不读取用户在 RunnerView 设置的其他 cwd。

## §5. `RunnerView.startOrCreateTab` 实现

```ts
// 纯函数 —— 单测目标
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

// RunnerView 上的公共方法
startOrCreateTab(name: string, command: string, cwd: string): RunnerTab {
  const { tab, created } = resolveOrCreateTab(this.tabs, name, command, cwd);
  if (created) {
    this.tabs.push(tab);
    this.expandedIds.add(tab.id);
    this.expandScrollId = tab.id;
    this.saveConfigs();
    this.renderAll();
  }
  // 复用与新建均启动 —— startProcess 内部幂等
  tab.output = "";
  startProcess(tab, () => this.scheduleRender());
  return tab;
}
```

注意：复用时**不修改**原 `tab.cwd`（用户可能已经手动调过）；新建时才用传入的 `cwd`。

## §6. UI / CSS

在 `styles.css` 中：

```css
/* 把按钮推到 head 右侧 */
.wli-section-head {
  /* 已有: flex + align-items: center; gap: 6px; cursor: pointer; */
  /* 新增: */
  position: relative;
}

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

按钮 SVG icon：lucide `wand-2`（代表"魔法修复"），通过 Obsidian 的 `setIcon(actionBtn, "wand-2")`。

按钮仅在 `key === "unresolved"` 时渲染；`key === "resolved"` 不渲染（保留现有 head 结构）。

## §7. 涉及文件

| 文件 | 改动 |
|---|---|
| `src/runner/process-host.ts` | **新增**：`RunnerHost` 接口 + 两个常量 + `resolveOrCreateTab` 纯函数 |
| `src/runner/process-host.test.ts` | **新增**：单测 |
| `src/runner/index.ts` | re-export `RunnerHost`、`resolveOrCreateTab`、两个常量 |
| `src/view/runner-view.ts` | 新增公共方法 `startOrCreateTab` |
| `src/wikilink-inspector/inspector-view.ts` | `renderSection` 中给 `key === "unresolved"` 的 head 追加按钮；新增 `onRepairBtnClick` |
| `src/wikilink-inspector/index.ts` | `InspectorViewOptions` 加可选字段 `onRepairUnresolvedLinks` |
| `main.ts` | 新增 `onRepairUnresolvedLinks()`、`getOrActivateRunnerView()` 两个私有方法；`registerView(WIKILINK_INSPECTOR_VIEW_TYPE, ...)` 注入回调 |
| `styles.css` | 加 `.wli-section-action` 规则 |

## §8. 测试

`src/runner/process-host.test.ts` 覆盖：

- `resolveOrCreateTab` 空数组 → 创建新 tab、`created: true`。
- `resolveOrCreateTab` 含同名 command → 复用原 tab、`created: false`。
- `resolveOrCreateTab` 含同名 command 但其他字段不同 → 仍按 command 匹配。
- `resolveOrCreateTab` 复用时返回的 tab 不被修改 cwd。
- `resolveOrCreateTab` 创建的 tab 字段正确（name / command / cwd / 初始 status="stopped" / child=null）。

DOM 与按钮点击的集成行为不写单测 —— 由 `obsidian-plugin-review` skill 的人工检查覆盖。

## §9. 范围与不做的事

- **不做**"按 source 笔记过滤" —— 按钮是仓库级动作。
- **不在** wikilink 视图里展示进程状态 / 进度 —— 用户去 RunnerView 看。
- **不改** `settings.repairLinksSkillInstalled` 默认值（保持 `false`）。
- **不改** `src/skills/repair-links.ts` 的 API。
- **不抽** `openSettings()` 引导动作到 host —— 引导只是 Notice + 已有方法,无需抽象。
- **不引入** 新设置项（按钮可见性、cwd 等都靠常量 + 现有 settings）。

## §10. 验证清单

- [ ] `npm run build` 通过
- [ ] `npm run lint` 通过
- [ ] 新增单元测试通过
- [ ] 现有测试不受影响
- [ ] 启用「双链检查」侧边栏,在未解析分组的 head 右侧看到 `wand-2` 图标
- [ ] 点击 → 命令在 RunnerView 中以"修复未解析双链"标签页启动
- [ ] 再次点击同名 command → 复用既有 tab（不再 push 新条目）
- [ ] 卸载 skill、关闭开关 → 点击触发 Notice + 设置页跳转
- [ ] 卸载 skill 但开关开着 → 点击触发启动、claude 自身报错（不特殊处理）
- [ ] 点击按钮不会触发 head 的折叠切换（`stopPropagation` 生效）
- [ ] `git status` 干净后 commit + push