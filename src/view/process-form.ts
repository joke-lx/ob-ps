import { Notice } from "obsidian";
import type { CommandGroup, CommandPreset } from "../types/commands";
import type { RunnerTab } from "../runner";
import { createTab } from "../runner";

/** 表单模式 */
export type FormMode = "add" | "edit";

/** 提交结果 —— 主类根据该返回值决定后续行为 */
export type FormSubmitResult =
  | { kind: "add"; tab: RunnerTab }
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
}

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
  header.createSpan({ cls: "runner-form-title", text: isEdit ? "编辑进程" : "新建进程" });

  // 表单字段
  const fields = panel.createDiv({ cls: "runner-form-fields" });

  // ---- 快捷命令组(仅新建模式且存在命令组时显示) ----
  let groupSelectEl: HTMLSelectElement | null = null;
  let presetSelectEl: HTMLSelectElement | null = null;

  if (!isEdit && groups.length > 0) {
    groupSelectEl = renderGroupSelect(fields, groups);
    presetSelectEl = renderPresetSelect(fields);
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

  // 绑定命令组联动(add 模式且存在)
  if (!isEdit && groups.length > 0 && groupSelectEl && presetSelectEl) {
    bindGroupPreset(
      groups,
      groupSelectEl,
      presetSelectEl,
      nameInput,
      cmdInput,
      cwdInput,
      ctx.defaultCwd,
    );
  }

  // 按钮行
  const actions = panel.createDiv({ cls: "runner-form-actions" });

  const cancelBtn = actions.createEl("button", {
    cls: "runner-form-btn is-cancel",
    text: "取消",
  });
  cancelBtn.addEventListener("click", () => ctx.onSubmit({ kind: "cancel" }));

  const submitBtn = actions.createEl("button", {
    cls: "runner-form-btn is-cta",
    text: isEdit ? "保存" : "运行",
  });
  submitBtn.addEventListener("click", () =>
    handleSubmit(
      ctx,
      nameInput.value,
      cmdInput.value,
      cwdInput.value,
    ),
  );

  // 键盘快捷键
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Enter") submitBtn.click();
    if (e.key === "Escape") cancelBtn.click();
  };
  nameInput.addEventListener("keydown", onKey);
  cmdInput.addEventListener("keydown", onKey);
  cwdInput.addEventListener("keydown", onKey);

  // 自动聚焦空字段
  if (!ctx.prefill.name) {
    nameInput.focus();
  } else {
    nameInput.focus();
    nameInput.select();
  }
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

/** 渲染组选择下拉 */
function renderGroupSelect(
  fields: HTMLElement,
  groups: CommandGroup[],
): HTMLSelectElement {
  const fd = fields.createDiv({ cls: "runner-form-field" });
  fd.createDiv({ cls: "runner-form-label", text: "快捷命令组" });
  const sel = fd.createEl("select", { cls: "runner-form-select" });

  const blank = document.createElement("option");
  blank.value = "";
  blank.text = "（不选择）";
  sel.add(blank);
  for (const g of groups) {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.text = g.name;
    sel.add(opt);
  }
  return sel;
}

/** 渲染预设下拉(初始 disabled) */
function renderPresetSelect(fields: HTMLElement): HTMLSelectElement {
  const fd = fields.createDiv({ cls: "runner-form-field" });
  fd.createDiv({ cls: "runner-form-label", text: "命令预设" });
  const sel = fd.createEl("select", { cls: "runner-form-select" });
  sel.disabled = true;
  const noGroup = document.createElement("option");
  noGroup.value = "";
  noGroup.text = "（请先选择命令组）";
  sel.add(noGroup);
  return sel;
}

/** 绑定组/预设联动 + 默认填充 */
function bindGroupPreset(
  groups: CommandGroup[],
  groupSelect: HTMLSelectElement,
  presetSelect: HTMLSelectElement,
  nameInput: HTMLInputElement,
  cmdInput: HTMLInputElement,
  cwdInput: HTMLInputElement,
  defaultCwd: string,
): void {
  groupSelect.addEventListener("change", () => {
    populatePresetDropdown(
      groups,
      groupSelect,
      presetSelect,
      nameInput,
      cmdInput,
      cwdInput,
      defaultCwd,
    );
  });

  presetSelect.addEventListener("change", () => {
    applySelectedPreset(
      groups,
      groupSelect,
      presetSelect,
      nameInput,
      cmdInput,
      cwdInput,
      defaultCwd,
    );
  });
}

/** 根据选中的命令组刷新预设下拉列表 */
function populatePresetDropdown(
  groups: CommandGroup[],
  groupSelect: HTMLSelectElement,
  presetSelect: HTMLSelectElement,
  nameInput: HTMLInputElement,
  cmdInput: HTMLInputElement,
  cwdInput: HTMLInputElement,
  defaultCwd: string,
): void {
  const gid = groupSelect.value;
  presetSelect.innerHTML = "";
  presetSelect.disabled = !gid;

  if (!gid) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.text = "（请先选择命令组）";
    presetSelect.add(opt);
    return;
  }

  const group = groups.find((g) => g.id === gid);
  if (!group || group.presets.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.text = "（该组无预设）";
    presetSelect.add(opt);
    return;
  }

  // 空白选项(允许手动输入)
  const blank = document.createElement("option");
  blank.value = "";
  blank.text = "（手动输入）";
  presetSelect.add(blank);

  for (let i = 0; i < group.presets.length; i++) {
    const p = group.presets[i];
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.text = `${p.name}  —  ${p.command}`;
    presetSelect.add(opt);
  }

  // 默认选中第一个预设并填充
  presetSelect.selectedIndex = 1;
  applySelectedPreset(
    groups,
    groupSelect,
    presetSelect,
    nameInput,
    cmdInput,
    cwdInput,
    defaultCwd,
  );
}

/** 根据选中的预设填充表单字段 */
function applySelectedPreset(
  groups: CommandGroup[],
  groupSelect: HTMLSelectElement,
  presetSelect: HTMLSelectElement,
  nameInput: HTMLInputElement,
  cmdInput: HTMLInputElement,
  cwdInput: HTMLInputElement,
  defaultCwd: string,
): void {
  const gid = groupSelect.value;
  const idx = parseInt(presetSelect.value, 10);
  if (!gid || Number.isNaN(idx)) return;

  const group = groups.find((g) => g.id === gid);
  if (!group || idx < 0 || idx >= group.presets.length) return;

  const preset: CommandPreset = group.presets[idx];
  nameInput.value = preset.name;
  cmdInput.value = preset.command;
  cwdInput.value = preset.cwd || defaultCwd;
}

/** 校验输入并触发 onSubmit */
function handleSubmit(
  ctx: ProcessFormContext,
  nameRaw: string,
  cmdRaw: string,
  cwdRaw: string,
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
  ctx.onSubmit({ kind: "add", tab });
}