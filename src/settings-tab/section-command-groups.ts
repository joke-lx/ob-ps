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
 * 渲染「命令组管理」区段:自定义下拉选择 + 下方详情面板。
 */
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

  // ---- 工具栏:自定义下拉 + 新建按钮 ----
  const toolbar = containerEl.createDiv({ cls: "cg-toolbar" });

  const { dropdownEl, menuEl } = buildDropdown(toolbar, groups, (id) => {
    if (!id) {
      detailEl.addClass("is-hidden");
      return;
    }
    const group = groups.find((g) => g.id === id);
    if (!group) {
      detailEl.addClass("is-hidden");
      return;
    }
    populateDetail(detailEl, group, groups, host);
    detailEl.removeClass("is-hidden");
  });

  const addBtn = toolbar.createEl("button", {
    cls: "cg-btn is-cta",
    text: "＋ 新建",
  });

  // ---- 详情面板(选中组时显示) ----
  const detailEl = containerEl.createDiv({ cls: "cg-detail" });
  detailEl.addClass("is-hidden");


  // ---- 事件绑定 ----

  addBtn.addEventListener("click", () => {
    const id = nextGroupId();
    groups.push({ id, name: "新命令", command: "", cwd: "" });
    void host.saveSettings().then(() => {
      host.refreshSettings();
    });
  });

  // 点击外部关闭下拉
  activeDocument.addEventListener("click", (e) => {
    if (!dropdownEl.contains(e.target as Node)) {
      menuEl.addClass("is-hidden");
    }
  });
}

/**
 * 构建自定义下拉:一个看起来像 input 的触发器 + 弹出菜单。
 * 点击触发器展开菜单,点击菜单项选中,回调 onSelect(id)。
 */
function buildDropdown(
  toolbar: HTMLElement,
  groups: CommandGroup[],
  onSelect: (id: string) => void,
): { dropdownEl: HTMLElement; triggerEl: HTMLElement; menuEl: HTMLElement } {
  const dropdownEl = toolbar.createDiv({ cls: "cg-dropdown" });

  // 触发器(显示当前值)
  const triggerEl = dropdownEl.createDiv({ cls: "cg-dropdown-trigger" });

  const labelEl = triggerEl.createSpan({ cls: "cg-dropdown-label" });
  const arrowEl = triggerEl.createSpan({ cls: "cg-dropdown-arrow" });
  setIcon(arrowEl, "chevron-down");

  // 弹出菜单
  const menuEl = dropdownEl.createDiv({ cls: "cg-dropdown-menu is-hidden" });

  function updateLabel(id: string | null): void {
    if (!id) {
      labelEl.textContent = "（不选择）";
      labelEl.addClass("is-placeholder");
    } else {
      const g = groups.find((x) => x.id === id);
      labelEl.textContent = g ? g.name : "（不选择）";
      labelEl.removeClass("is-placeholder");
    }
  }

  function populateMenu(): void {
    menuEl.empty();
    if (groups.length === 0) {
      const item = menuEl.createDiv({ cls: "cg-dropdown-item is-disabled" });
      item.textContent = "（暂无命令组,点新建）";
      return;
    }
    const blank = menuEl.createDiv({ cls: "cg-dropdown-item" });
    blank.textContent = "（不选择）";
    blank.dataset.id = "";
    blank.addEventListener("click", () => {
      updateLabel(null);
      onSelect("");
      menuEl.addClass("is-hidden");
    });
    for (const g of groups) {
      const item = menuEl.createDiv({ cls: "cg-dropdown-item" });
      item.textContent = g.name || "（未命名）";
      item.dataset.id = g.id;
      item.addEventListener("click", () => {
        updateLabel(g.id);
        onSelect(g.id);
        menuEl.addClass("is-hidden");
      });
    }
  }

  // 初始填充 + 默认标签
  populateMenu();
  updateLabel(null);

  // 点击触发器展开/收起
  triggerEl.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasHidden = menuEl.hasClass("is-hidden");
    menuEl.toggleClass("is-hidden", !wasHidden);
    // 展开时刷新菜单(同步 groups 可能的变化)
    if (wasHidden) {
      populateMenu();
    }
  });

  // 点击菜单项不冒泡到 document 关闭
  menuEl.addEventListener("click", (e) => e.stopPropagation());

  return { dropdownEl, triggerEl, menuEl };
}

/**
 * 填充详情面板:与内联行列表相同的新行样式,
 * 但只渲染一条(当前选中组)。
 */
function populateDetail(
  detailEl: HTMLElement,
  group: CommandGroup,
  groups: CommandGroup[],
  host: CommandGroupsSectionHost,
): void {
  detailEl.empty();

  // 行体:命令展示 + 删除按钮在行尾
  const header = detailEl.createDiv({ cls: "cg-row-header" });
  const info = header.createDiv({ cls: "cg-row-info" });
  const nameEl = info.createSpan({
    cls: "cg-row-name",
    text: group.name || "（未命名）",
  });

  // 删除按钮在行尾
  const delBtn = header.createEl("button", {
    cls: "cg-row-btn is-danger",
    attr: { title: "删除此命令" },
  });
  setIcon(delBtn, "trash-2");
  delBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const idx = groups.findIndex((g) => g.id === group.id);
    if (idx < 0) return;
    groups.splice(idx, 1);
    void host.saveSettings().then(() => host.refreshSettings());
  });

  // 编辑抽屉(直接展开)
  const drawer = detailEl.createDiv({ cls: "cg-drawer-inline" });

  const nameInput = drawer.createEl("input", {
    cls: "cg-drawer-input",
    attr: { placeholder: "命令名称", spellcheck: "false" },
  });
  nameInput.value = group.name;
  nameInput.addEventListener("change", () => {
    group.name = nameInput.value;
    nameEl.textContent = nameInput.value || "（未命名）";
    void host.saveSettings();
  });

  const cmdInput = drawer.createEl("input", {
    cls: "cg-drawer-input is-mono",
    attr: { placeholder: "命令,如 npm run dev", spellcheck: "false" },
  });
  cmdInput.value = group.command;
  cmdInput.addEventListener("change", () => {
    group.command = cmdInput.value;
    void host.saveSettings();
  });

  const cwdInput = drawer.createEl("input", {
    cls: "cg-drawer-input is-mono",
    attr: { placeholder: "工作目录(空表示用 vault 根目录)", spellcheck: "false" },
  });
  cwdInput.value = group.cwd;
  cwdInput.addEventListener("change", () => {
    group.cwd = cwdInput.value;
    void host.saveSettings();
  });

  // 自动聚焦命令名输入框
  nameInput.focus();
  nameInput.select();
}
