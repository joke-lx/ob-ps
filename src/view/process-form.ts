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
    saveBtn.classList.add("is-hidden");
    saveToGroupBtn.classList.add("is-hidden");
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