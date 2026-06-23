# 命令组管理重构 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把命令组从「一组多预设」扁平化为「一组一命令」;设置页改为单下拉 + 内联抽屉编辑;新建进程表单增加「保存」(不启动) 和「保存到命令组」两个动作;旧数据按「每条预设 → 一个新组」自动迁移。

**Architecture:**
- 数据层: `CommandGroup` 直接含 `command` 和 `cwd`,删除 `CommandPreset`。
- 迁移层: 新增 `migrateCommandGroups` 纯函数,在 main.ts 加载 settings 时调用一次。
- 视图层: 设置页用单一 `<select>` + 内联抽屉面板;新建进程表单用单下拉 + 4 按钮(取消/保存到命令组/保存/运行)。
- 持久化层: `ViewOptions` 新增 `onSaveCommandGroups` 回调,与现有 `onSaveConfigs` 对称。

**Tech Stack:** TypeScript, Obsidian API (Setting/Notice/Modal), vitest, esbuild

## Global Constraints

- 命名/文件位置: 沿用现有 `src/{runner,view,settings-tab,types}/` 布局。
- 行数: 每个文件 ≤ 400 行(coding-style.md)。
- 不可变性: 配置用 `Object.assign` 合并,不直接 `mutate` 外部对象。
- 错误处理: 用户输入错误用 `Notice` 提示,不在 UI 上抛错。
- 测试框架: vitest,所有纯函数必须有对应测试。
- 提交规范: Conventional Commits,每完成一个 Task 提交一次。
- 中文 UI 文案: 与现有 `runner-form-`、`setting-` 前缀保持一致;占位文案风格与现有对齐。
- 不在范围内: 不动 `startOrCreateTab` / `findTabByCommand` / 双链修复流程;不引入 Modal 弹窗;不保留多预设分组语义。

---

## File Structure

| 文件 | 责任 |
|---|---|
| `src/types/commands.ts` | `CommandGroup` 形状定义(扁平) |
| `src/settings-tab/migrate-command-groups.ts` | 旧多预设 → 新单命令的迁移纯函数 |
| `src/settings-tab/migrate-command-groups.test.ts` | 迁移单测 |
| `src/settings-tab/section-command-groups.ts` | 设置页区段渲染(下拉 + 抽屉) |
| `src/view/process-form.ts` | 新建/编辑进程表单 |
| `src/view/runner-view.ts` | RunnerView 主体(`handleFormSubmit` 扩展) |
| `main.ts` | 插件入口(加载迁移、接线 `onSaveCommandGroups`) |
| `styles.css` | 新增抽屉样式,删除旧组卡片样式 |
| ~~`src/settings-tab/group-editor.ts`~~ | **删除** |
| ~~`src/settings-tab/preset-editor.ts`~~ | **删除** |
| `src/view/index.ts` | 重新导出,删 `CommandPreset` |
| `src/settings-tab/group-id.ts` | 保留(复用 `nextGroupId`) |

---

## Task 1: 扁平化 `CommandGroup` 数据模型

**Files:**
- Modify: `src/types/commands.ts`
- Modify: `src/view/index.ts:6`

**Interfaces:**
- Produces: `CommandGroup { id: string; name: string; command: string; cwd: string }`(无 presets)
- Removes: `CommandPreset` 接口

- [ ] **Step 1: 修改 `src/types/commands.ts`**

把整个文件替换为:

```ts
/**
 * 命令组(用户自定义的快捷命令)
 * 用于新建进程表单的快捷下拉填充。
 *
 * 重构 2026-06-23:扁平化,组本身即一条命令,取消原先的 presets 数组。
 */
export interface CommandGroup {
  id: string;
  name: string;     // = 命令显示名
  command: string;  // 单条命令
  cwd: string;      // 工作目录(空表示用默认)
}
```

- [ ] **Step 2: 修改 `src/view/index.ts:6`**

把:
```ts
export type { CommandGroup, CommandPreset } from "../types/commands";
```
改为:
```ts
export type { CommandGroup } from "../types/commands";
```

- [ ] **Step 3: 运行类型检查,确认所有引用方已可见**

运行:
```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npx tsc -noEmit -skipLibCheck 2>&1
```
预期:在 `src/view/process-form.ts:2,306` 和 `src/view/runner-view.ts:223` 处报错(`CommandPreset` 引用已删除;`presets` 字段不存在)。这是预期的,我们在 Task 2-5 修复。**不要在此 Task 修复 process-form/runner-view**——它们会在后续 Task 重写。确认只有这两类报错即可。

- [ ] **Step 4: 提交**

```bash
git add src/types/commands.ts src/view/index.ts
git commit -m "refactor(types): flatten CommandGroup to single command, remove CommandPreset"
```

---

## Task 2: 编写 `migrateCommandGroups` 纯函数 + 测试

**Files:**
- Create: `src/settings-tab/migrate-command-groups.ts`
- Create: `src/settings-tab/migrate-command-groups.test.ts`

**Interfaces:**
- Consumes: `unknown[]`(任意输入,运行时检测旧形状)
- Produces: `CommandGroup[]` 扁平化结果
- Uses: `nextGroupId()` from `./group-id`

- [ ] **Step 1: 写失败的测试**

新建 `src/settings-tab/migrate-command-groups.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { migrateCommandGroups } from "./migrate-command-groups";

describe("migrateCommandGroups", () => {
  it("空数组返回空数组", () => {
    expect(migrateCommandGroups([])).toEqual([]);
  });

  it("新形状原样保留并补全缺失 cwd", () => {
    const input = [
      { id: "g1", name: "dev", command: "npm run dev" },
      { id: "g2", name: "build", command: "npm run build", cwd: "/abs" },
    ];
    const out = migrateCommandGroups(input);
    expect(out).toEqual([
      { id: "g1", name: "dev", command: "npm run dev", cwd: "" },
      { id: "g2", name: "build", command: "npm run build", cwd: "/abs" },
    ]);
  });

  it("旧形状单预设组拆为 1 个新组", () => {
    const input = [
      {
        id: "old1",
        name: "dev-group",
        presets: [{ name: "frontend", command: "npm run dev", cwd: "/p" }],
      },
    ];
    const out = migrateCommandGroups(input);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("frontend");
    expect(out[0].command).toBe("npm run dev");
    expect(out[0].cwd).toBe("/p");
    expect(out[0].id).not.toBe("old1"); // 重新分配
  });

  it("旧形状多预设组拆为 N 个新组", () => {
    const input = [
      {
        id: "old1",
        name: "fallback",
        presets: [
          { name: "a", command: "cmd-a", cwd: "" },
          { name: "b", command: "cmd-b", cwd: "/b" },
          { name: "c", command: "cmd-c", cwd: "" },
        ],
      },
    ];
    const out = migrateCommandGroups(input);
    expect(out).toHaveLength(3);
    expect(out.map((g) => g.name)).toEqual(["a", "b", "c"]);
    expect(out.map((g) => g.command)).toEqual(["cmd-a", "cmd-b", "cmd-c"]);
    expect(out.map((g) => g.cwd)).toEqual(["", "/b", ""]);
  });

  it("预设缺 name 时回退到组名", () => {
    const input = [
      {
        id: "old",
        name: "group-name",
        presets: [{ name: "", command: "echo hi", cwd: "" }],
      },
    ];
    const out = migrateCommandGroups(input);
    expect(out[0].name).toBe("group-name");
  });

  it("预设 command 和 name 都为空时丢弃", () => {
    const input = [
      {
        id: "old",
        name: "g",
        presets: [
          { name: "", command: "", cwd: "" },
          { name: "ok", command: "echo", cwd: "" },
        ],
      },
    ];
    const out = migrateCommandGroups(input);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("ok");
  });

  it("混合新旧形状都正确处理", () => {
    const input = [
      { id: "new1", name: "n1", command: "c1", cwd: "" },
      {
        id: "old1",
        name: "g1",
        presets: [{ name: "p1", command: "c2", cwd: "" }],
      },
    ];
    const out = migrateCommandGroups(input);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("new1");
    expect(out[1].name).toBe("p1");
  });

  it("生成的 id 互不相同", () => {
    const input = [
      {
        id: "old",
        name: "g",
        presets: [
          { name: "a", command: "ca", cwd: "" },
          { name: "b", command: "cb", cwd: "" },
        ],
      },
    ];
    const out = migrateCommandGroups(input);
    expect(new Set(out.map((g) => g.id)).size).toBe(out.length);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

运行:
```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npx vitest run src/settings-tab/migrate-command-groups.test.ts 2>&1
```
预期:FAIL(模块不存在)。

- [ ] **Step 3: 实现 `migrateCommandGroups`**

新建 `src/settings-tab/migrate-command-groups.ts`:

```ts
import type { CommandGroup } from "../types/commands";
import { nextGroupId } from "./group-id";

/** 旧形状的预设(运行时检测用,不要在业务代码引用) */
interface LegacyPreset {
  name?: string;
  command?: string;
  cwd?: string;
}

/** 旧形状的组(运行时检测用) */
interface LegacyGroup {
  id?: string;
  name?: string;
  presets?: LegacyPreset[];
}

/** 任意形状的组(运行时分流) */
type AnyGroup = LegacyGroup | Partial<CommandGroup> | Record<string, unknown>;

/** 输入项是否带 presets 数组(旧形状) */
function isLegacy(g: AnyGroup): g is LegacyGroup {
  return Array.isArray((g as LegacyGroup).presets);
}

/**
 * 把任意形状的 commandGroups 输入规范化成扁平 CommandGroup[]。
 *
 * 旧形状(带 presets 数组):每条非空预设 → 一个新组(组名取 preset.name ?? 原 group.name)。
 * 新形状:原样保留,缺失的 cwd 补成 ""。
 *
 * 纯函数:不修改输入,不读写文件,不抛错(无法识别时尽量保留)。
 */
export function migrateCommandGroups(input: unknown): CommandGroup[] {
  if (!Array.isArray(input)) return [];
  const result: CommandGroup[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const g = raw as AnyGroup;
    if (isLegacy(g)) {
      const fallbackName = (g.name ?? "").trim();
      const presets = g.presets ?? [];
      for (const p of presets) {
        const name = (p.name ?? "").trim() || fallbackName;
        const command = (p.command ?? "").trim();
        if (!name && !command) continue; // 全部为空 → 丢弃
        result.push({
          id: nextGroupId(),
          name,
          command,
          cwd: (p.cwd ?? "").trim(),
        });
      }
    } else {
      // 新形状:直接取字段,缺失则空
      const cg = g as Partial<CommandGroup>;
      result.push({
        id: (cg.id ?? nextGroupId()).toString() || nextGroupId(),
        name: (cg.name ?? "").toString(),
        command: (cg.command ?? "").toString(),
        cwd: (cg.cwd ?? "").toString(),
      });
    }
  }
  return result;
}
```

- [ ] **Step 4: 运行测试,确认通过**

运行:
```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npx vitest run src/settings-tab/migrate-command-groups.test.ts 2>&1
```
预期:8/8 PASS。

- [ ] **Step 5: 运行全套测试,确认无回归**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npx vitest run 2>&1
```
预期:之前 16 个测试 + 新增 8 个 = 24 个 PASS。注意:`process-host.test.ts` 中有 `makeTab` 构造 RunnerTab,Task 1 之后会因 generation 字段缺失报错(已在之前 commit 修复过),**本次 Task 不应引入新失败**;如果其他无关测试失败,排查。

- [ ] **Step 6: 提交**

```bash
git add src/settings-tab/migrate-command-groups.ts src/settings-tab/migrate-command-groups.test.ts
git commit -m "feat(settings): add migrateCommandGroups for legacy presets-shape to flat one-command-per-group"
```

---

## Task 3: main.ts 加载 settings 时调用迁移

**Files:**
- Modify: `main.ts:70-77`(在 `Object.assign` 之后,`reconcileInstalledFlag` 之前)

**Interfaces:**
- Uses: `migrateCommandGroups` from `./src/settings-tab/migrate-command-groups`
- Mutates: `this.settings.commandGroups` 并在发生变化时 `await saveSettings()`

- [ ] **Step 1: 修改 main.ts**

在 main.ts 第 71 行(`this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);`)之后插入:

```ts
    // 3. 迁移 commandGroups:旧「一组多预设」→ 新「一组一命令」
    const rawGroups = this.settings.commandGroups;
    const migratedGroups = migrateCommandGroups(rawGroups);
    const migrated = !shallowEqualGroups(rawGroups, migratedGroups);
    this.settings.commandGroups = migratedGroups;
    if (migrated) {
      await this.saveSettings();
    }
```

并在文件顶部(`import { ... }` 区)添加 import:

```ts
import { migrateCommandGroups } from "./src/settings-tab/migrate-command-groups";
```

并在文件底部(类外部或底部辅助区)添加一个浅比较函数:

```ts
/** 浅比较两组数组的元素是否一致(按当前形状逐字段比较) */
function shallowEqualGroups(
  a: unknown,
  b: import("./src/types/commands").CommandGroup[],
): boolean {
  if (!Array.isArray(a)) return b.length === 0;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as Record<string, unknown>;
    const y = b[i];
    if (x.id !== y.id) return false;
    if (x.name !== y.name) return false;
    if (x.command !== y.command) return false;
    if ((x.cwd ?? "") !== (y.cwd ?? "")) return false;
  }
  return true;
}
```

(注意:这段是工程上的「是否需要写盘」判断,避免每次启动都写盘;`shallowEqualGroups` 也可以放进 migrate-command-groups.ts 并 export,但作为 main.ts 的本地辅助更内聚。)

- [ ] **Step 2: 跑类型检查**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npx tsc -noEmit -skipLibCheck 2>&1
```
预期:0 错误。

- [ ] **Step 3: 跑测试 + 构建**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npx vitest run 2>&1 | tail -5
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npm run build 2>&1 | tail -5
```
预期:测试 24/24 通过;build 成功(此时 process-form.ts 和 runner-view.ts 仍引用 `presets`,Task 4-5 会修;如果 build 失败,只允许这 2 个文件错误)。

- [ ] **Step 4: 提交**

```bash
git add main.ts
git commit -m "feat(main): migrate legacy commandGroups on load and persist normalized shape"
```

---

## Task 4: 重写新建进程表单(单下拉 + 4 按钮)

**Files:**
- Rewrite: `src/view/process-form.ts`(整个文件)
- Modify: `src/view/index.ts`(re-export 不变)

**Interfaces:**
- Produces: 新的 `FormSubmitResult`:
  ```ts
  export type FormSubmitResult =
    | { kind: "add"; tab: RunnerTab; autostart: boolean }
    | { kind: "edit"; tab: RunnerTab }
    | { kind: "cancel" };
  ```
- 新的 `ProcessFormContext`:
  ```ts
  export interface ProcessFormContext {
    mode: FormMode;
    editingTab: RunnerTab | null;
    prefill: FormPrefill;
    commandGroups: CommandGroup[];
    defaultCwd: string;
    onSubmit: (result: FormSubmitResult) => void;
    /** 「保存到命令组」回调:把当前 name/command/cwd 写入命令库 */
    onSaveToGroup: (entry: { name: string; command: string; cwd: string }) => void;
  }
  ```

- [ ] **Step 1: 完整重写 `src/view/process-form.ts`**

把整个文件替换为:

```ts
import { Notice } from "obsidian";
import type { CommandGroup } from "../types/commands";
import type { RunnerTab } from "../runner";
import { createTab } from "../runner";

/** 表单模式 */
export type FormMode = "add" | "edit";

/** 提交结果 —— 主类根据该返回值决定后续行为 */
export type FormSubmitResult =
  | { kind: "add"; tab: RunnerTab; autostart: boolean }
  | { kind: "edit"; tab: RunnerTab }
  | { kind: "cancel" };

/** 表单预填数据 */
export interface FormPrefill {
  name: string;
  command: string;
  cwd: string;
}

/** 表单渲染上下文 */
export interface ProcessFormContext {
  /** 模式:add 新建 / edit 编辑 */
  mode: FormMode;
  /** 编辑模式时被编辑的 tab(add 模式时为 null) */
  editingTab: RunnerTab | null;
  /** 预填数据 */
  prefill: FormPrefill;
  /** 命令组(用于快捷下拉填充) */
  commandGroups: CommandGroup[];
  /** 默认工作目录(vault 根) */
  defaultCwd: string;
  /** 提交回调(校验通过后调用) */
  onSubmit: (result: FormSubmitResult) => void;
  /** 「保存到命令组」回调:把当前 name/command/cwd 写入命令库 */
  onSaveToGroup: (entry: { name: string; command: string; cwd: string }) => void;
}

const NO_GROUP_VALUE = "";

/**
 * 渲染内联表单到 formEl 容器,绑定键盘快捷键、自动聚焦等行为。
 * 校验失败由本函数直接弹出 Notice 并阻止提交。
 */
export function renderProcessForm(
  formEl: HTMLElement,
  ctx: ProcessFormContext,
): void {
  formEl.empty();
  const isEdit = ctx.mode === "edit";
  const groups = ctx.commandGroups;

  const panel = formEl.createDiv({ cls: `runner-form-panel is-${ctx.mode}` });

  // 标题
  const header = panel.createDiv({ cls: "runner-form-header" });
  header.createSpan({
    cls: "runner-form-title",
    text: isEdit ? "编辑进程" : "新建进程",
  });

  // 表单字段
  const fields = panel.createDiv({ cls: "runner-form-fields" });

  // ---- 快捷命令下拉(仅新建模式且存在命令组时显示) ----
  let commandSelectEl: HTMLSelectElement | null = null;
  if (!isEdit && groups.length > 0) {
    commandSelectEl = renderCommandSelect(fields, groups);
  }

  // 名称
  const nameInput = renderInputField(
    fields,
    "名称",
    "runner-form-input",
    "显示名称",
    ctx.prefill.name,
  );

  // 命令
  const cmdInput = renderInputField(
    fields,
    "命令",
    "runner-form-input",
    "如 npm run dev",
    ctx.prefill.command,
  );

  // 工作目录
  const cwdInput = renderInputField(
    fields,
    "工作目录",
    "runner-form-input",
    "默认为 vault 根目录",
    ctx.prefill.cwd,
  );

  // 绑定下拉联动
  if (!isEdit && commandSelectEl) {
    commandSelectEl.addEventListener("change", () => {
      applySelectedCommand(
        groups,
        commandSelectEl,
        nameInput,
        cmdInput,
        cwdInput,
        ctx.defaultCwd,
      );
    });
  }

  // 按钮行
  const actions = panel.createDiv({ cls: "runner-form-actions" });

  const cancelBtn = actions.createEl("button", {
    cls: "runner-form-btn is-cancel",
    text: "取消",
  });
  cancelBtn.addEventListener("click", () => ctx.onSubmit({ kind: "cancel" }));

  const saveToGroupBtn = actions.createEl("button", {
    cls: "runner-form-btn is-ghost",
    text: "保存到命令组",
    title: "把当前命令加入命令组列表(不启动进程、不关闭表单)",
  });
  saveToGroupBtn.addEventListener("click", () => {
    handleSaveToGroup(ctx, nameInput.value, cmdInput.value, cwdInput.value);
  });

  const saveBtn = actions.createEl("button", {
    cls: "runner-form-btn",
    text: "保存",
    title: "仅保存到侧边栏,不启动进程",
  });
  saveBtn.addEventListener("click", () =>
    handleSubmit(ctx, nameInput.value, cmdInput.value, cwdInput.value, false),
  );

  const submitBtn = actions.createEl("button", {
    cls: "runner-form-btn is-cta",
    text: isEdit ? "保存" : "运行",
  });
  submitBtn.addEventListener("click", () => {
    if (isEdit) {
      handleSubmit(ctx, nameInput.value, cmdInput.value, cwdInput.value, true);
    } else {
      handleSubmit(ctx, nameInput.value, cmdInput.value, cwdInput.value, true);
    }
  });
  if (isEdit) {
    // 编辑模式:把中间的「保存」按钮隐藏(只有「取消」+「保存」两个动作)
    saveBtn.style.display = "none";
    saveToGroupBtn.style.display = "none";
  }

  // 键盘快捷键
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Enter") submitBtn.click();
    if (e.key === "Escape") cancelBtn.click();
  };
  nameInput.addEventListener("keydown", onKey);
  cmdInput.addEventListener("keydown", onKey);
  cwdInput.addEventListener("keydown", onKey);

  // 自动聚焦空字段
  nameInput.focus();
  if (ctx.prefill.name) nameInput.select();
}

// ---- 内部辅助 ----------------------------------------------------------

/** 渲染单个 label+input 行 */
function renderInputField(
  fields: HTMLElement,
  label: string,
  inputCls: string,
  placeholder: string,
  initialValue: string,
): HTMLInputElement {
  const fd = fields.createDiv({ cls: "runner-form-field" });
  fd.createDiv({ cls: "runner-form-label", text: label });
  const input = fd.createEl("input", {
    cls: inputCls,
    attr: { placeholder, spellcheck: "false" },
  });
  input.value = initialValue;
  return input;
}

/** 渲染命令组下拉(单层,扁平) */
function renderCommandSelect(
  fields: HTMLElement,
  groups: CommandGroup[],
): HTMLSelectElement {
  const fd = fields.createDiv({ cls: "runner-form-field" });
  fd.createDiv({ cls: "runner-form-label", text: "快捷命令" });
  const sel = fd.createEl("select", { cls: "runner-form-select" });

  const blank = sel.createEl("option");
  blank.value = NO_GROUP_VALUE;
  blank.text = "（不选择）";

  for (const g of groups) {
    const opt = sel.createEl("option");
    opt.value = g.id;
    opt.text = `${g.name}  —  ${g.command || "（无命令）"}`;
  }
  return sel;
}

/** 根据选中的命令组填充表单字段(选回「不选择」不清空已填字段) */
function applySelectedCommand(
  groups: CommandGroup[],
  commandSelect: HTMLSelectElement,
  nameInput: HTMLInputElement,
  cmdInput: HTMLInputElement,
  cwdInput: HTMLInputElement,
  defaultCwd: string,
): void {
  const gid = commandSelect.value;
  if (!gid) return; // 空白选项:保留当前填写
  const group = groups.find((g) => g.id === gid);
  if (!group) return;
  nameInput.value = group.name;
  cmdInput.value = group.command;
  cwdInput.value = group.cwd || defaultCwd;
}

/** 「保存到命令组」处理:委托给 ctx.onSaveToGroup */
function handleSaveToGroup(
  ctx: ProcessFormContext,
  nameRaw: string,
  cmdRaw: string,
  cwdRaw: string,
): void {
  const name = nameRaw.trim();
  const command = cmdRaw.trim();
  if (!command) {
    new Notice("请输入命令后再保存到命令组");
    return;
  }
  if (!name) {
    new Notice("请输入名称后再保存到命令组");
    return;
  }
  const cwd = cwdRaw.trim();
  ctx.onSaveToGroup({ name, command, cwd });
}

/** 校验输入并触发 onSubmit */
function handleSubmit(
  ctx: ProcessFormContext,
  nameRaw: string,
  cmdRaw: string,
  cwdRaw: string,
  autostart: boolean,
): void {
  const name = nameRaw.trim();
  const command = cmdRaw.trim();
  if (!name) {
    new Notice("请输入名称");
    return;
  }
  if (!command) {
    new Notice("请输入命令");
    return;
  }
  const cwd = cwdRaw.trim() || ctx.defaultCwd;

  if (ctx.mode === "edit" && ctx.editingTab) {
    ctx.editingTab.name = name;
    ctx.editingTab.command = command;
    ctx.editingTab.cwd = cwd;
    ctx.onSubmit({ kind: "edit", tab: ctx.editingTab });
    return;
  }

  const tab = createTab(name, command, cwd);
  // startProcess 由主类负责 —— 它需要把回调接进自己的 scheduleRender
  ctx.onSubmit({ kind: "add", tab, autostart });
}
```

- [ ] **Step 2: 跑类型检查(预期 runner-view.ts 报错)**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npx tsc -noEmit -skipLibCheck 2>&1
```
预期:`runner-view.ts` 在 `handleFormSubmit` 处报错,因为 `result` 的 `kind: "add"` 现在带 `autostart` 字段,而代码里没用;以及 `renderForm` 没有传 `onSaveToGroup`。**这是预期的**,在 Task 5 修。

- [ ] **Step 3: 提交**

```bash
git add src/view/process-form.ts
git commit -m "refactor(form): single command-group dropdown, add save and save-to-group actions"
```

---

## Task 5: 扩展 `RunnerView` 处理 `autostart` + 接线 `onSaveToGroup` / `onSaveCommandGroups`

**Files:**
- Modify: `src/view/runner-view.ts`
  - `ViewOptions` 接口新增 `onSaveCommandGroups`
  - `renderForm()` 传 `onSaveToGroup` + 关闭 form 时清缓存
  - `handleFormSubmit` 处理 `autostart`
  - 新增 `handleSaveToGroup()` 私有方法

**Interfaces:**
- `ViewOptions` 新增:
  ```ts
  onSaveCommandGroups: (groups: CommandGroup[]) => void;
  ```

- [ ] **Step 1: 修改 `ViewOptions` 接口**

在 `src/view/runner-view.ts` 的 `ViewOptions` 中,把现有的:
```ts
  onSaveConfigs: (configs: ProcessConfig[]) => void;
```
之后追加:
```ts
  /** 把 settings.commandGroups 写回磁盘 */
  onSaveCommandGroups: (groups: CommandGroup[]) => void;
```

并在文件顶部 import 区加:
```ts
import type { CommandGroup } from "../types/commands";
```
(注意:`runner-view.ts` 当前没 import `CommandGroup`,需要加。)

- [ ] **Step 2: 修改 `handleFormSubmit`**

把现有的:
```ts
  /** 表单提交处理:写回 tabs / 启动新进程 / 关闭表单 */
  private handleFormSubmit(result: FormSubmitResult): void {
    if (result.kind === "cancel") {
      this.clearForm();
      return;
    }

    if (result.kind === "edit") {
      this.saveConfigs();
      this.clearForm();
      return;
    }

    // add
    this.tabs.push(result.tab);
    startProcess(result.tab, () => this.scheduleRender());
    this.expandedIds.add(result.tab.id);
    this.expandScrollId = result.tab.id;
    this.saveConfigs();
    this.clearForm();
  }
```

替换为:
```ts
  /** 表单提交处理:写回 tabs / 启动新进程 / 关闭表单 */
  private handleFormSubmit(result: FormSubmitResult): void {
    if (result.kind === "cancel") {
      this.clearForm();
      return;
    }

    if (result.kind === "edit") {
      this.saveConfigs();
      this.clearForm();
      return;
    }

    // add
    this.tabs.push(result.tab);
    if (result.autostart) {
      startProcess(result.tab, () => this.scheduleRender());
    }
    this.expandedIds.add(result.tab.id);
    this.expandScrollId = result.tab.id;
    this.saveConfigs();
    this.clearForm();
  }

  /** 「保存到命令组」:把当前命令写入 settings.commandGroups 并落盘 */
  private handleSaveToGroup(entry: {
    name: string;
    command: string;
    cwd: string;
  }): void {
    const groups = this.opts.settings.commandGroups ?? [];
    // 按 command 去重(忽略前后空格)
    const cmd = entry.command.trim();
    const dup = groups.find((g) => g.command.trim() === cmd);
    if (dup) {
      new Notice(`命令组「${dup.name}」已存在该命令,未重复添加`);
      return;
    }
    const next: CommandGroup[] = [
      ...groups,
      {
        id: `g-${Date.now().toString(36)}-${groups.length + 1}`,
        name: entry.name.trim(),
        command: cmd,
        cwd: entry.cwd.trim(),
      },
    ];
    this.opts.settings.commandGroups = next;
    this.opts.onSaveCommandGroups(next);
    new Notice(`已加入命令组「${entry.name}」`);
    // 不关表单,不建 tab;下拉会在下次 renderForm 时自动反映新值
  }
```

并在顶部 import 区加:
```ts
import { Notice } from "obsidian";
```
(如果已经存在则跳过。)

- [ ] **Step 3: 修改 `renderForm`,传 `onSaveToGroup`**

找到 `renderForm` 中调用 `renderProcessForm` 的位置(在 `renderForm` 方法内),在传入的 ctx 对象里加 `onSaveToGroup: (entry) => this.handleSaveToGroup(entry)`。

完整 `renderForm` 关键片段参考(以现有代码为骨架):
```ts
    renderProcessForm(this.formEl, {
      mode: this.formMode,
      editingTab,
      prefill,
      commandGroups: this.opts.settings.commandGroups ?? [],
      defaultCwd: this.defaultCwd,
      onSubmit: (result) => this.handleFormSubmit(result),
      onSaveToGroup: (entry) => this.handleSaveToGroup(entry),
    });
```

- [ ] **Step 4: 跑类型检查(预期 main.ts 报错)**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npx tsc -noEmit -skipLibCheck 2>&1
```
预期:`main.ts` 在 `buildViewOptions` 处报错,因为 `ViewOptions.onSaveCommandGroups` 是必填,main.ts 没传。**这是预期的**,在 Task 6 修。

- [ ] **Step 5: 提交**

```bash
git add src/view/runner-view.ts
git commit -m "feat(runner-view): honor autostart flag, add onSaveToGroup with dedup"
```

---

## Task 6: main.ts 接线 `onSaveCommandGroups`

**Files:**
- Modify: `main.ts` 的 `buildViewOptions`

- [ ] **Step 1: 在 `buildViewOptions` 中加 `onSaveCommandGroups`**

把现有的:
```ts
  private buildViewOptions(): ViewOptions {
    return {
      defaultCwd: this.getDefaultCwd(),
      settings: this.settings,
      onSaveConfigs: (configs) => {
        this.savedConfigs = configs;
        void this.saveSettings();
      },
      onOpenInspector: () => void this.activateInspectorView(),
    };
  }
```

替换为:
```ts
  private buildViewOptions(): ViewOptions {
    return {
      defaultCwd: this.getDefaultCwd(),
      settings: this.settings,
      onSaveConfigs: (configs) => {
        this.savedConfigs = configs;
        void this.saveSettings();
      },
      onSaveCommandGroups: (groups) => {
        this.settings.commandGroups = groups;
        void this.saveSettings();
      },
      onOpenInspector: () => void this.activateInspectorView(),
    };
  }
```

- [ ] **Step 2: 跑类型检查,确认无错**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npx tsc -noEmit -skipLibCheck 2>&1
```
预期:0 错误。

- [ ] **Step 3: 跑测试 + 构建**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npx vitest run 2>&1 | tail -5
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npm run build 2>&1 | tail -5
```
预期:24/24 测试通过;build 成功(此时 settings-tab 还引用旧的 group-editor/preset-editor,Task 7-8 修;如果 build 失败,只允许 settings-tab 相关错误)。

- [ ] **Step 4: 提交**

```bash
git add main.ts
git commit -m "feat(main): wire onSaveCommandGroups to persist settings.commandGroups"
```

---

## Task 7: 重写设置页区段(下拉 + 内联抽屉)

**Files:**
- Rewrite: `src/settings-tab/section-command-groups.ts`(整个文件)
- Modify: `src/settings-tab/index.ts:75-80`(可能不需要改,接口已兼容)

**Interfaces:**
- 现有的 `CommandGroupsSectionHost` 已包含 `settings.commandGroups` / `saveSettings` / `refreshSettings`,直接复用。

- [ ] **Step 1: 重写 `src/settings-tab/section-command-groups.ts`**

把整个文件替换为:

```ts
import { Setting } from "obsidian";
import type { CommandGroup } from "../types/commands";
import { nextGroupId } from "./group-id";

/** 设置标签页需要的插件能力最小集 */
export interface CommandGroupsSectionHost {
  settings: { commandGroups: CommandGroup[] };
  saveSettings(): Promise<void>;
  /** 通知宿主重新绘制整个设置页(用于 add / del 后) */
  refreshSettings(): void;
}

/** 渲染「命令组管理」区段:标题 + 描述 + 全部命令组下拉 + 内联抽屉编辑 */
export function render(
  containerEl: HTMLElement,
  host: CommandGroupsSectionHost,
): void {
  new Setting(containerEl).setName("命令组管理").setHeading();
  containerEl.createDiv({
    cls: "setting-item-description",
    text: "定义快捷命令,新建进程时可通过下拉列表快速填充命令",
  });

  const groups = host.settings.commandGroups;
  const currentId = containerEl.getAttr("data-cg-current") ?? "";

  // ---- 工具行: select + 新建 + 删除 ----
  const toolbar = containerEl.createDiv({ cls: "cg-toolbar" });

  const select = toolbar.createEl("select", { cls: "cg-select" });
  if (groups.length === 0) {
    const blank = select.createEl("option");
    blank.value = "";
    blank.text = "（暂无命令组,点新建）";
    blank.disabled = true;
    blank.selected = true;
  } else {
    const blank = select.createEl("option");
    blank.value = "";
    blank.text = "（不选择）";
    for (const g of groups) {
      const opt = select.createEl("option");
      opt.value = g.id;
      opt.text = `${g.name}  —  ${g.command || "（无命令）"}`;
      if (g.id === currentId) opt.selected = true;
    }
    if (!currentId) select.value = "";
  }

  const newBtn = toolbar.createEl("button", {
    cls: "cg-btn is-cta",
    text: "＋ 新建",
  });
  newBtn.addEventListener("click", () => {
    const id = nextGroupId();
    groups.push({ id, name: "新命令", command: "", cwd: "" });
    containerEl.setAttr("data-cg-current", id);
    void host.saveSettings().then(() => host.refreshSettings());
  });

  const delBtn = toolbar.createEl("button", {
    cls: "cg-btn is-danger",
    text: "✕ 删除",
  });
  const hasSelection = !!currentId && groups.some((g) => g.id === currentId);
  delBtn.disabled = !hasSelection;
  delBtn.addEventListener("click", () => {
    if (!hasSelection) return;
    const idx = groups.findIndex((g) => g.id === currentId);
    if (idx < 0) return;
    groups.splice(idx, 1);
    containerEl.setAttr("data-cg-current", "");
    void host.saveSettings().then(() => host.refreshSettings());
  });

  // select 切换时:刷新抽屉区
  select.addEventListener("change", () => {
    containerEl.setAttr("data-cg-current", select.value);
    void host.refreshSettings();
  });

  // ---- 抽屉面板(仅当选中某组时渲染) ----
  if (hasSelection) {
    const group = groups.find((g) => g.id === currentId);
    if (group) {
      renderDrawer(containerEl, group, host);
    }
  }
}

/** 渲染内联抽屉面板:名称/命令/工作目录三输入框,onChange 自动落盘 */
function renderDrawer(
  containerEl: HTMLElement,
  group: CommandGroup,
  host: CommandGroupsSectionHost,
): void {
  const drawer = containerEl.createDiv({ cls: "cg-drawer" });

  const nameInput = drawer.createEl("input", {
    cls: "cg-input",
    attr: { placeholder: "命令名称" },
  });
  nameInput.value = group.name;
  nameInput.addEventListener("change", () => {
    group.name = nameInput.value;
    void host.saveSettings().then(() => host.refreshSettings());
  });

  const cmdInput = drawer.createEl("input", {
    cls: "cg-input is-mono",
    attr: { placeholder: "命令,如 npm run dev" },
  });
  cmdInput.value = group.command;
  cmdInput.addEventListener("change", () => {
    group.command = cmdInput.value;
    void host.saveSettings();
  });

  const cwdInput = drawer.createEl("input", {
    cls: "cg-input is-mono",
    attr: { placeholder: "工作目录(空表示用 vault 根目录)" },
  });
  cwdInput.value = group.cwd;
  cwdInput.addEventListener("change", () => {
    group.cwd = cwdInput.value;
    void host.saveSettings();
  });
}
```

- [ ] **Step 2: 跑类型检查 + 构建**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npx tsc -noEmit -skipLibCheck 2>&1
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npm run build 2>&1 | tail -5
```
预期:0 错误;build 成功(此时 group-editor / preset-editor 还没删,Task 8 删;它们的死代码不会影响 build,因为没人 import 它们)。

- [ ] **Step 3: 提交**

```bash
git add src/settings-tab/section-command-groups.ts
git commit -m "refactor(settings): section-command-groups to dropdown + inline drawer"
```

---

## Task 8: 删除已废弃的 `group-editor.ts` / `preset-editor.ts`

**Files:**
- Delete: `src/settings-tab/group-editor.ts`
- Delete: `src/settings-tab/preset-editor.ts`
- Modify: `src/settings-tab/index.ts`(如果还有 import 这两个)

- [ ] **Step 1: 确认无引用方**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && grep -rn "group-editor\|preset-editor" src/ main.ts
```
预期:仅在 `src/settings-tab/index.ts` 等「不再需要」的位置出现;**无 import 语句**。

如果有 import,删掉。

- [ ] **Step 2: 删除文件**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && git rm src/settings-tab/group-editor.ts src/settings-tab/preset-editor.ts
```

- [ ] **Step 3: 跑类型检查 + 构建 + 测试**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npx tsc -noEmit -skipLibCheck 2>&1
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npm run build 2>&1 | tail -5
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npx vitest run 2>&1 | tail -5
```
预期:0 错误;build 成功;24/24 测试通过。

- [ ] **Step 4: 提交**

```bash
git add -A src/settings-tab/group-editor.ts src/settings-tab/preset-editor.ts
git commit -m "chore(settings): remove obsolete group-editor and preset-editor"
```

---

## Task 9: CSS 更新(抽屉样式 + 删除旧组卡片样式)

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: 查找旧样式**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && grep -n "setting-group-card\|setting-group-header\|setting-group-name-input\|setting-group-actions\|setting-group-btn\|setting-presets\|setting-preset-row\|setting-preset-col\|setting-preset-label\|setting-preset-input" styles.css
```
预期:列出要删除的旧规则。

- [ ] **Step 2: 删除旧规则,新增抽屉样式**

删除:
```css
.setting-group-card { ... }
.setting-group-header { ... }
.setting-group-name-input { ... }
.setting-group-actions { ... }
.setting-group-btn { ... }
.setting-group-btn.is-danger { ... }
.setting-group-btn.is-add { ... }
.setting-presets { ... }
.setting-preset-row { ... }
.setting-preset-col { ... }
.setting-preset-label { ... }
.setting-preset-input { ... }
.setting-preset-input.is-mono { ... }
```

(具体规则行数通过 `grep` 定位后用 Edit 删除。)

在文件末尾追加:
```css
/* 命令组管理:下拉 + 抽屉 */
.cg-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}
.cg-select {
  flex: 1;
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
  color: var(--text-normal);
}
.cg-btn {
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
  color: var(--text-normal);
  cursor: pointer;
}
.cg-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.cg-btn.is-cta {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  border-color: var(--interactive-accent);
}
.cg-btn.is-danger {
  background: var(--background-secondary);
  color: var(--text-error);
  border-color: var(--text-error);
}
.cg-drawer {
  margin: 8px 0 16px 0;
  padding: 10px 12px;
  border: 1px solid var(--background-modifier-border);
  border-left: 3px solid var(--interactive-accent);
  border-radius: 4px;
  background: var(--background-secondary);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cg-input {
  width: 100%;
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
  color: var(--text-normal);
  box-sizing: border-box;
}
.cg-input.is-mono {
  font-family: var(--font-monospace);
}
.runner-form-btn.is-ghost {
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--background-modifier-border);
}
.runner-form-btn.is-ghost:hover {
  color: var(--text-normal);
  background: var(--background-modifier-hover);
}
```

- [ ] **Step 3: 跑构建 + lint**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npm run build 2>&1 | tail -5
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npm run lint 2>&1 | tail -5
```
预期:build 成功;lint 干净。

- [ ] **Step 4: 提交**

```bash
git add styles.css
git commit -m "style(settings): dropdown + drawer styles for command groups; remove legacy card styles"
```

---

## Task 10: 最终全量验证

**Files:** 无改动

- [ ] **Step 1: 类型检查**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npx tsc -noEmit -skipLibCheck 2>&1
```
预期:0 错误。

- [ ] **Step 2: 全部测试**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npx vitest run 2>&1
```
预期:24/24 通过(16 旧 + 8 新迁移测试)。

- [ ] **Step 3: 构建**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npm run build 2>&1 | tail -5
```
预期:`tsc -noEmit && esbuild --production` 成功,`main.js` 产物更新。

- [ ] **Step 4: lint**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && npm run lint 2>&1 | tail -5
```
预期:0 警告。

- [ ] **Step 5: git status 检查**

```bash
cd "D:\DevProjects\my\test\test\obsidian\ob-ps" && git status
```
预期:working tree clean(若有未提交改动,补提交)。

- [ ] **Step 6: 写验收报告**

如有任何失败,把实际输出贴出并修复。

---

## Self-Review Checklist

在动手前请自审:

- [ ] **Spec 覆盖**:
  - 数据模型扁平化 → Task 1 ✓
  - 迁移函数 → Task 2 ✓
  - main.ts 迁移调用 → Task 3 ✓
  - 新建进程表单(单下拉 + 4 按钮) → Task 4 ✓
  - RunnerView 扩展 → Task 5 ✓
  - main.ts 接线 onSaveCommandGroups → Task 6 ✓
  - 设置页(下拉 + 抽屉) → Task 7 ✓
  - 删除旧文件 → Task 8 ✓
  - CSS → Task 9 ✓
  - 验证 → Task 10 ✓
- [ ] **无占位符**:每步都有具体代码 / 命令 / 预期输出。
- [ ] **类型一致性**:`FormSubmitResult`、`ProcessFormContext`、`ViewOptions.onSaveCommandGroups`、`migrateCommandGroups` 签名在所有 Task 中一致。
- [ ] **无 spec 遗漏**:「抽屉」用内联展开(方案 A);「保存到命令组」按 command 去重 + Notice 提示;「保存」不启动、status=stopped;「运行」autostart=true;旧数据每条预设 → 一个新组。
