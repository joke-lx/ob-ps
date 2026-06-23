# 命令组管理重构 — 设计文档

- **日期**: 2026-06-23
- **范围**: ob-ps (Obsidian local-runner 插件)
- **状态**: 已确认,待实现

## Context

当前「命令组管理」(settings.commandGroups)采用「一组多预设」结构(`CommandGroup.presets: CommandPreset[]`),设置页为每个组渲染一张卡片,卡片内可上下移、增删多条预设。新建进程表单则用两层下拉(组 → 预设)填充。存在三个问题:

1. **结构过重**:实际使用中一组通常只对应一条命令,多预设层级徒增认知负担和表单复杂度。
2. **设置页视觉臃肿**:每个组一张全展开的卡片,占据大量纵向空间,不够聚焦。
3. **新建流程不闭环**:新建进程时无法把当前命令快速回存为快捷命令;且新建进程只有「运行」,缺少「仅保存不启动」。

本次重构把命令组扁平化为「一组一命令」,设置页改为「单下拉 + 内联抽屉编辑」,新建进程表单增加「保存」(仅存侧边栏不启动)和「保存到命令组」(把当前命令加入命令库)两个动作。

## 目标与非目标

**目标**
- `CommandGroup` 扁平化:取消 `presets[]`,组本身即一条命令(name + command + cwd)。
- 设置页:单一 `<select>` 列出全部命令组 + 内联抽屉面板编辑详情;空状态显示占位。
- 新建进程表单:单下拉(选中即填充)、「运行 / 保存 / 保存到命令组」三个动作。
- 旧数据按「每条预设 → 一个新组」自动迁移。

**非目标**
- 不保留「一组多命令」的分组语义。
- 不引入 Modal 弹窗编辑(用内联抽屉)。
- 不改变「双链修复」流程对 `findTabByCommand` / `startOrCreateTab` 的使用。
- 不调整 `group-id.ts` 的 id 生成逻辑。

## 数据模型

### 新形状 (`src/types/commands.ts`)

```ts
export interface CommandGroup {
  id: string;
  name: string;      // = 命令显示名(组名即命令名)
  command: string;   // 单条命令
  cwd: string;       // 工作目录(空表示用默认)
}
```

移除 `CommandPreset` 接口。`src/types/settings.ts` 中 `commandGroups: CommandGroup[]` 字段名不变,仅元素形状变化。

### 迁移函数

新增 `migrateCommandGroups(groups: unknown): CommandGroup[]`(置于 `src/runner` 或 `src/settings-tab` 下的纯函数模块),逻辑:

- 遍历输入元素;
- 若元素带 `presets` 数组(旧形状):对该数组每条非空预设(p.command 或 p.name 任一存在)生成一个新组,组名取 `preset.name` ?? 原 `group.name`,command/cwd 取预设值,`id` 调 `nextGroupId()` 重新分配;
- 否则(已是新形状)原样保留并补齐缺失字段(`cwd ?? ""`)。

在 `main.ts` 加载 settings 之后、注册设置页之前调用一次;若返回结果与输入结构不同(发生了拆分),写回 `await saveSettings()`。

迁移用 vitest 覆盖:空数组、纯新形状、纯旧形状(单预设/多预设)、混合形状、空预设过滤。

## 组件设计

### 1. 设置页:`section-command-groups.ts` 重写

**布局**

```
命令组管理 (heading)
说明文字
[ <select> 全部命令组 ▼ ]  [＋ 新建]  [✕ 删除]
─────────────────────────────────────
(选中某组后,下方内联展开抽屉面板)
  名称:    [______________]
  命令:    [______________]
  工作目录: [_____________]
```

**行为**
- `select` 列出全部 `commandGroups`,每个 option 的 value=group.id,text=group.name。
- 空状态(`commandGroups.length === 0`):select 仅一个禁用占位 option「（暂无命令组,点新建）」,删除按钮禁用,不渲染抽屉。
- 选中某组 → 下方渲染抽屉面板:三个 `<input>`,`change` 事件直接写回 `group.*` 并 `saveSettings()`(无需 `refreshSettings`,因为是同对象引用原地改)。
- 选中组切换 → 抽屉重新渲染为新选中组的字段。
- 「＋ 新建」:追加 `{ id: nextGroupId(), name: "新命令", command: "", cwd: "" }`,`saveSettings()`,并把 select 选中指向新组 id,展开抽屉、聚焦命令输入框。
- 「✕ 删除」:移除当前选中组,`saveSettings()`,`refreshSettings()`,select 回退到首项(或空状态)。

**删除文件**
- `src/settings-tab/group-editor.ts`
- `src/settings-tab/preset-editor.ts`

(组内上下移、预设增删逻辑随扁平化消失。)

**保留**
- `src/settings-tab/group-id.ts`(`nextGroupId` 复用)。

### 2. 新建进程表单:`process-form.ts` 重写

**下拉简化**:原「组 → 预设」两层下拉合并为单层「快捷命令」下拉,首项为空白 option「（不选择）」,选中某 commandGroup 即把 name/command/cwd 填入表单三个字段,选回「（不选择）」不清空已填字段(允许用户先选再手改)。移除 `renderPresetSelect` / `bindGroupPreset` / `populatePresetDropdown` / `applySelectedPreset`,改为单函数 `renderCommandSelect` + `applySelectedCommand`。

**下拉自动刷新**:`renderForm()` 每次从 `this.opts.settings.commandGroups` 取最新引用传入 `renderProcessForm`。由于 settings 是同对象引用,设置页的改动立即可见 —— 已天然满足,实现时确认传的是 `this.opts.settings.commandGroups` 而非缓存的快照。

**按钮区(4 个)**

| 按钮 | 行为 | 关表单? | 建 tab? | 启动? | 入命令组? |
|---|---|---|---|---|---|
| 取消 | 关表单 | 是 | 否 | 否 | 否 |
| 保存到命令组 | 把当前 name/command/cwd 写成新 CommandGroup 追加到 `settings.commandGroups` 并持久化;按 `command` 去重(已存在则 Notice 提示并跳过);不关表单、不建 tab | 否 | 否 | 否 | 是 |
| 保存 | 建 RunnerTab,`status="stopped"`,追加到侧边栏,`saveConfigs()`,关表单 | 是 | 是 | 否 | 否 |
| 运行 | 建 RunnerTab,`startProcess()`,追加到侧边栏,`saveConfigs()`,关表单(现状) | 是 | 是 | 是 | 否 |

**「保存到命令组」组名规则**:组名 = 表单的 name 字段(组名即命令名)。command 为空时不允许(Notice 提示)。

### 3. `FormSubmitResult` 扩展 (`process-form.ts`)

```ts
export type FormSubmitResult =
  | { kind: "add"; tab: RunnerTab; autostart: boolean }
  | { kind: "edit"; tab: RunnerTab }
  | { kind: "cancel" };

export interface ProcessFormContext {
  // ... 现有字段 ...
  /** 「保存到命令组」回调:把当前表单内容写入命令库 */
  onSaveToGroup: (entry: { name: string; command: string; cwd: string }) => void;
}
```

`onSubmit({ kind: "add", tab, autostart })`:运行=autostart:true / 保存=autostart:false。

### 4. `runner-view.ts` 适配

- `renderForm()` 传入新增的 `onSaveToGroup` 回调,实现:从 `this.opts.settings.commandGroups` 去重判断 → 追加新 CommandGroup → 调用持久化(需新增一个把 commandGroups 落盘的途径,见下)。
- `handleFormSubmit` 处理 `add` 分支时,按 `result.autostart` 决定是否 `startProcess`。
- **持久化命令组**:当前 `ViewOptions` 只有 `onSaveConfigs(configs)`(落盘 RunnerTab)。需新增 `onSaveCommandGroups: (groups: CommandGroup[]) => void`,由 `main.ts` 接到 `plugin.settings.commandGroups = groups; saveSettings()`。或复用一个更通用的 `onSaveSettings`。决策见「待定」。

## 涉及文件清单

| 文件 | 改动类型 |
|---|---|
| `src/types/commands.ts` | 修改:`CommandGroup` 扁平化,删 `CommandPreset` |
| `src/types/settings.ts` | 修改:确认引用(形状变化,无新字段) |
| `src/runner/` 或 `src/settings-tab/` | 新增:`migrateCommandGroups` 纯函数 + 单测 |
| `main.ts` | 修改:加载后迁移;接线 `onSaveCommandGroups` |
| `src/settings-tab/section-command-groups.ts` | 重写:下拉 + 抽屉 |
| `src/settings-tab/group-editor.ts` | 删除 |
| `src/settings-tab/preset-editor.ts` | 删除 |
| `src/settings-tab/group-id.ts` | 保留 |
| `src/view/process-form.ts` | 重写:单下拉 + 3 按钮 + `FormSubmitResult` 扩展 |
| `src/view/runner-view.ts` | 修改:`renderForm`/`handleFormSubmit` + `onSaveToGroup`/`onSaveCommandGroups` |
| `styles.css` | 修改:新增抽屉面板样式,删旧 `.setting-group-card/.setting-presets/.setting-preset-row` 等 |

## 验证

**自动**
- `npx tsc -noEmit -skipLibCheck` — 0 错误
- `npx vitest run` — 含新增 `migrateCommandGroups` 测试,全部通过
- `npm run build` — 产物生成
- `npm run lint` — 干净

**手动(Obsidian 内)**
1. 设置页:空状态显示占位;点「＋ 新建」→ 出现新组并展开抽屉;编辑三个字段后切走再切回,值已持久化;「✕ 删除」生效。
2. 旧数据:构造一个含多预设的旧 `data.json`,启动后该组被拆成多个新组,每条预设一条。
3. 新建进程表单:下拉显示全部命令组(含刚在设置页加的);选中即填充;「运行」启动;「保存」建表项不启动(灰色「已停止」);「保存到命令组」把当前命令加入设置页下拉(去重)。
4. 重启 Obsidian:迁移结果与表项都保留。

## 实现决策(已定)

- **命令组持久化通路**:`ViewOptions` 新增 `onSaveCommandGroups: (groups: CommandGroup[]) => void` 回调,由 `main.ts` 接 `plugin.settings.commandGroups = groups; await this.saveSettings()`。与现有 `onSaveConfigs` 对称,职责单一。
