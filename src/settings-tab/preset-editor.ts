import type { CommandGroup } from "../types/commands";
import type { CommandGroupsSectionHost } from "./section-command-groups";

/**
 * 渲染单条命令预设的编辑器(名称 / 命令 / 工作目录 / 删除)。
 */
export function renderPresetEditor(
  wrap: HTMLElement,
  groups: CommandGroup[],
  gi: number,
  pi: number,
  host: CommandGroupsSectionHost,
): void {
  const preset = groups[gi].presets[pi];

  const row = wrap.createDiv({ cls: "setting-preset-row" });

  // 名
  const nameCol = row.createDiv({ cls: "setting-preset-col" });
  nameCol.createDiv({ cls: "setting-preset-label", text: "名称" });
  const nameInput = nameCol.createEl("input", {
    cls: "setting-preset-input",
    attr: { placeholder: "显示名称" },
  });
  nameInput.value = preset.name;
  nameInput.addEventListener("change", () => {
    preset.name = nameInput.value;
    void host.saveSettings();
  });

  // 命令
  const cmdCol = row.createDiv({ cls: "setting-preset-col is-grow" });
  cmdCol.createDiv({ cls: "setting-preset-label", text: "命令" });
  const cmdInput = cmdCol.createEl("input", {
    cls: "setting-preset-input is-mono",
    attr: { placeholder: "npm run dev" },
  });
  cmdInput.value = preset.command;
  cmdInput.addEventListener("change", () => {
    preset.command = cmdInput.value;
    void host.saveSettings();
  });

  // 工作目录
  const cwdCol = row.createDiv({ cls: "setting-preset-col is-grow" });
  cwdCol.createDiv({ cls: "setting-preset-label", text: "工作目录" });
  const cwdInput = cwdCol.createEl("input", {
    cls: "setting-preset-input is-mono",
    attr: { placeholder: "默认为 vault 根目录" },
  });
  cwdInput.value = preset.cwd;
  cwdInput.addEventListener("change", () => {
    preset.cwd = cwdInput.value;
    void host.saveSettings();
  });

  // 删除
  const actCol = row.createDiv({ cls: "setting-preset-col is-action" });
  const delBtn = actCol.createEl("button", {
    cls: "setting-group-btn is-danger",
    text: "✕",
    attr: { title: "删除此预设" },
  });
  delBtn.addEventListener("click", () => {
    groups[gi].presets.splice(pi, 1);
    void host.saveSettings().then(() => host.refreshSettings());
  });
}