import type { CommandGroup } from "../types/commands";
import type { CommandGroupsSectionHost } from "./section-command-groups";
import { renderPresetEditor } from "./preset-editor";

/**
 * 渲染单个命令组的编辑器(名称 + 上下移 + 删除 + 预设列表 + 添加预设)。
 */
export function renderGroupEditor(
  containerEl: HTMLElement,
  groups: CommandGroup[],
  gi: number,
  host: CommandGroupsSectionHost,
): void {
  const group = groups[gi];

  const wrap = containerEl.createDiv({ cls: "setting-group-card" });

  // ---- 组头: 名称 + 操作按钮 ----
  const headerRow = wrap.createDiv({ cls: "setting-group-header" });

  const nameInput = headerRow.createEl("input", {
    cls: "setting-group-name-input",
    attr: { placeholder: "组名称,如 dev server" },
  });
  nameInput.value = group.name;
  nameInput.addEventListener("change", () => {
    group.name = nameInput.value;
    void host.saveSettings();
  });

  const btnRow = headerRow.createDiv({ cls: "setting-group-actions" });

  if (gi > 0) {
    const upBtn = btnRow.createEl("button", {
      cls: "setting-group-btn",
      text: "↑",
      attr: { title: "上移" },
    });
    upBtn.addEventListener("click", () => {
      [groups[gi], groups[gi - 1]] = [groups[gi - 1], groups[gi]];
      void host.saveSettings().then(() => host.refreshSettings());
    });
  }
  if (gi < groups.length - 1) {
    const downBtn = btnRow.createEl("button", {
      cls: "setting-group-btn",
      text: "↓",
      attr: { title: "下移" },
    });
    downBtn.addEventListener("click", () => {
      [groups[gi], groups[gi + 1]] = [groups[gi + 1], groups[gi]];
      void host.saveSettings().then(() => host.refreshSettings());
    });
  }

  const delBtn = btnRow.createEl("button", {
    cls: "setting-group-btn is-danger",
    text: "✕",
    attr: { title: "删除组" },
  });
  delBtn.addEventListener("click", () => {
    groups.splice(gi, 1);
    void host.saveSettings().then(() => host.refreshSettings());
  });

  // ---- 预设列表 ----
  const presetsWrap = wrap.createDiv({ cls: "setting-presets" });
  for (let pi = 0; pi < group.presets.length; pi++) {
    renderPresetEditor(presetsWrap, groups, gi, pi, host);
  }

  // 添加预设按钮
  const addPresetBtn = wrap.createEl("button", {
    cls: "setting-group-btn is-add",
    text: "＋ 添加命令",
    attr: { title: "添加命令预设" },
  });
  addPresetBtn.addEventListener("click", () => {
    group.presets.push({ name: "", command: "", cwd: "" });
    void host.saveSettings().then(() => host.refreshSettings());
  });
}