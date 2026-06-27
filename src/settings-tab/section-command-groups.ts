import { Setting, setIcon } from "obsidian";
import type { CommandGroup } from "../types/commands";
import { nextGroupId } from "./group-id";

/** 设置标签页需要的插件能力最小集 */
export interface CommandGroupsSectionHost {
  settings: { commandGroups: CommandGroup[] };
  saveSettings(): Promise<void>;
  /** 通知宿主重新绘制整个设置页(用于 add / del 后) */
  refreshSettings(): void;
}

/**
 * 渲染「命令组管理」区段:展开卡片列表,每条命令均可编辑、切换可见、删除。
 * 不再使用下拉选择,所有命令全部展开。
 */
export function render(
  containerEl: HTMLElement,
  host: CommandGroupsSectionHost,
): void {
  new Setting(containerEl).setName("命令组管理").setHeading();
  containerEl.createDiv({
    cls: "setting-item-description",
    text: "管理侧边栏快捷启动命令,通过右侧眼睛图标控制是否在侧边栏显示。所有命令全部展开,直接编辑。",
  });

  const groups = host.settings.commandGroups;

  // ---- 工具栏:新建按钮 ----
  const toolbar = containerEl.createDiv({ cls: "cg-toolbar" });
  const addBtn = toolbar.createEl("button", {
    cls: "cg-btn is-cta",
    text: "＋ 新建",
  });
  addBtn.addEventListener("click", () => {
    const id = nextGroupId();
    groups.push({ id, name: "新命令", command: "", cwd: "", visible: true });
    void host.saveSettings().then(() => {
      host.refreshSettings();
    });
  });

  // ---- 命令列表(展开) ----
  if (groups.length === 0) {
    containerEl.createDiv({
      cls: "cg-empty",
      text: "暂无命令组,点击「＋ 新建」添加",
    });
    return;
  }

  for (const group of groups) {
    const card = containerEl.createDiv({ cls: "cg-card" });
    if (group.visible === false) {
      card.addClass("is-hidden-cmd");
    }

    // 顶栏:名称 + 可见性 + 删除
    const topRow = card.createDiv({ cls: "cg-card-top" });

    const nameInput = topRow.createEl("input", {
      cls: "cg-card-name",
      attr: { placeholder: "命令名称", spellcheck: "false" },
    });
    nameInput.value = group.name;
    nameInput.addEventListener("change", () => {
      group.name = nameInput.value;
      void host.saveSettings();
    });

    const rightGroup = topRow.createDiv({ cls: "cg-card-actions" });

    // 可见性切换
    const visBtn = rightGroup.createDiv({
      cls: "cg-card-btn" + (group.visible !== false ? " is-visible" : ""),
      title: group.visible !== false ? "点击隐藏" : "点击显示",
    });
    setIcon(visBtn, group.visible !== false ? "eye" : "eye-off");
    visBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      group.visible = group.visible === false ? true : false;
      setIcon(visBtn, group.visible ? "eye" : "eye-off");
      visBtn.setAttr("title", group.visible ? "点击隐藏" : "点击显示");
      visBtn.toggleClass("is-visible", group.visible);
      card.toggleClass("is-hidden-cmd", !group.visible);
      void host.saveSettings();
    });

    // 删除按钮
    const delBtn = rightGroup.createDiv({
      cls: "cg-card-btn is-danger",
      title: "删除此命令",
    });
    setIcon(delBtn, "trash-2");
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = groups.findIndex((g) => g.id === group.id);
      if (idx < 0) return;
      groups.splice(idx, 1);
      void host.saveSettings().then(() => host.refreshSettings());
    });

    // 命令输入
    const cmdInput = card.createEl("input", {
      cls: "cg-card-input is-mono",
      attr: { placeholder: "命令,如 npm run dev", spellcheck: "false" },
    });
    cmdInput.value = group.command;
    cmdInput.addEventListener("change", () => {
      group.command = cmdInput.value;
      void host.saveSettings();
    });

    // 目录输入
    const cwdInput = card.createEl("input", {
      cls: "cg-card-input is-mono",
      attr: { placeholder: "工作目录(空表示用 vault 根目录)", spellcheck: "false" },
    });
    cwdInput.value = group.cwd;
    cwdInput.addEventListener("change", () => {
      group.cwd = cwdInput.value;
      void host.saveSettings();
    });
  }
}
