import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import {
  createTab,
  isRunning,
  RunnerTab,
  startProcess,
  stopProcess,
} from "./runner";

export const RUNNER_VIEW_TYPE = "local-runner-view";

/** 持久化的进程配置(不含运行时状态) */
export interface ProcessConfig {
  id: string;
  name: string;
  command: string;
  cwd: string;
}

// ---- 插件设置 ---------------------------------------------------------------

export interface PluginSettings {
  confirmBeforeDelete: boolean;
  autoScrollOutput: boolean;
  maxOutputChars: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  confirmBeforeDelete: true,
  autoScrollOutput: true,
  maxOutputChars: 200_000,
};

export interface ViewOptions {
  defaultCwd: string;
  settings: PluginSettings;
  onSaveConfigs: (configs: ProcessConfig[]) => void;
}

/**
 * 右侧栏控制台视图。维护一组可持久化的进程配置,
 * 每个进程一行,含状态指示灯 + 启动/停止按钮 + 可展开的输出日志。
 */
export class RunnerView extends ItemView {
  private tabs: RunnerTab[] = [];
  private readonly expandedIds = new Set<string>();
  private rafScheduled = false;
  /** 刚展开的项目 ID,下一帧渲染后自动滚动到底部 */
  private expandScrollId: string | null = null;
  private readonly opts: ViewOptions;

  /** 待应用的配置(onOpen 前收到时暂存) */
  private pendingConfigs: ProcessConfig[] | null = null;

  // ---- 内联表单状态 ----
  /** null = 无表单; 'add' / 'edit' = 当前激活的表单模式 */
  private formMode: 'add' | 'edit' | null = null;
  /** edit 模式时,正在编辑的标签页 ID */
  private editingTabId: string | null = null;

  // DOM 缓存
  private listEl!: HTMLElement;
  private formEl!: HTMLElement;
  private readonly outputElMap = new Map<string, HTMLElement>();

  getViewType(): string {
    return RUNNER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "本地进程";
  }

  getIcon(): string {
    return "terminal";
  }

  constructor(leaf: WorkspaceLeaf, opts: ViewOptions) {
    super(leaf);
    this.opts = opts;
  }

  async onOpen(): Promise<void> {
    this.buildUi();
    if (this.pendingConfigs) {
      this.setTabsFromConfigs(this.pendingConfigs);
      this.pendingConfigs = null;
    }
  }

  async onClose(): Promise<void> {
    for (const tab of this.tabs) {
      if (tab.child) {
        stopProcess(tab, () => {});
      }
    }
  }

  // ---- Public API for main.ts -----------------------------------------------

  /** 从持久化的配置恢复标签页(全部为停止状态) */
  setTabsFromConfigs(configs: ProcessConfig[]): void {
    if (!this.listEl) {
      this.pendingConfigs = configs;
      return;
    }
    this.tabs = configs.map((c) => ({
      id: c.id,
      name: c.name,
      command: c.command,
      cwd: c.cwd,
      status: "stopped",
      exitCode: null,
      output: "",
      child: null,
    }));
    this.expandedIds.clear();
    this.outputElMap.clear();
    this.renderAll();
  }

  /** 更新已注入的设置(main.ts 在设置变更时调用) */
  updateSettings(): void {
    // 目前设置仅在交互时校验,无需重建 UI
  }

  // ---- UI Build -------------------------------------------------------------

  private buildUi(): void {
    const root = this.contentEl.createDiv({ cls: "runner-view" });

    // 头部:标题 + 设置按钮
    const header = root.createDiv({ cls: "runner-header" });
    header.createSpan({ cls: "runner-header-title", text: "本地进程管理" });

    const headerRight = header.createDiv({ cls: "runner-header-right" });

    const settingsBtn = headerRight.createDiv({
      cls: "runner-header-btn",
      title: "设置",
    });
    setIcon(settingsBtn, "gear");
    settingsBtn.addEventListener("click", () => void this.openSettings());

    const addBtn = headerRight.createDiv({
      cls: "runner-header-btn",
      title: "新建进程",
    });
    setIcon(addBtn, "plus");
    addBtn.addEventListener("click", () => this.showAddForm());

    // 内联表单容器(在列表之前)
    this.formEl = root.createDiv({ cls: "runner-form-container" });

    // 进程列表
    this.listEl = root.createDiv({ cls: "runner-list" });
  }

  /** 打开 Obsidian 设置 → Local Runner 标签页 */
  private async openSettings(): Promise<void> {
    await this.app.setting.open();
    // openTabById 在类型中缺失但运行时存在
    (this.app.setting as any).openTabById("local-runner");
  }

  // ---- Render ----------------------------------------------------------------

  /**
   * 轻量渲染(RFA 节流):仅更新展开项的输出文本及所有项的状态指示器。
   * 由 startProcess / stopProcess 的回调触发。
   */
  private scheduleRender(): void {
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    window.requestAnimationFrame(() => {
      this.rafScheduled = false;
      for (const tab of this.tabs) {
        this.updateItemStatus(tab);
        if (this.expandedIds.has(tab.id)) {
          this.renderItemOutput(tab);
        }
      }
      this.expandScrollId = null;
    });
  }

  /** 全量渲染:重建整个列表(增/删/展开切换后调用) */
  private renderAll(): void {
    this.listEl.empty();
    this.outputElMap.clear();

    if (this.tabs.length === 0 && !this.formMode) {
      this.listEl.createDiv({
        cls: "runner-empty",
        text: "暂无进程,点击 ＋ 添加",
      });
      return;
    }

    for (const tab of this.tabs) {
      // edit 模式下,被编辑的标签页由表单占据,列表中跳过
      if (this.formMode === "edit" && tab.id === this.editingTabId) continue;
      this.renderItem(tab);
    }
  }

  private renderItem(tab: RunnerTab): void {
    const item = this.listEl.createDiv({ cls: "runner-item" });
    if (this.expandedIds.has(tab.id)) item.addClass("is-expanded");
    item.setAttr("data-id", tab.id);

    // ---- 按钮卡片:点击整张卡片切换启动/停止 ----
    const card = item.createDiv({ cls: `runner-btn-card is-${tab.status}` });
    card.addEventListener("click", () => this.toggleProcess(tab));

    // 左:指示灯 + 自定义名称(主标签)
    const left = card.createDiv({ cls: "runner-card-left" });
    const dot = left.createDiv({ cls: `runner-dot is-${tab.status}` });
    const nameEl = left.createSpan({ cls: "runner-name", text: tab.name });
    nameEl.setAttr("title", `${tab.command}\n${tab.cwd}`);

    // 右:展开箭头 + 编辑 + 删除
    const right = card.createDiv({ cls: "runner-card-right" });

    // 展开/收起
    const expandIcon = right.createDiv({ cls: "runner-expand" });
    setIcon(expandIcon, this.expandedIds.has(tab.id) ? "chevron-up" : "chevron-down");
    expandIcon.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleExpand(tab.id);
    });

    // 编辑
    const editBtn = right.createDiv({ cls: "runner-card-btn is-edit" });
    setIcon(editBtn, "pencil");
    editBtn.setAttr("title", "编辑");
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showEditForm(tab);
    });

    // 删除
    const delBtn = right.createDiv({ cls: "runner-card-btn is-delete" });
    delBtn.setText("×");
    delBtn.setAttr("title", "删除进程");
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.deleteProcess(tab.id);
    });

    // ---- 卡片底部:状态文字 ----
    const meta = item.createDiv({ cls: "runner-card-meta" });
    meta.createSpan({ cls: `runner-status-text is-${tab.status}`, text: this.statusLabel(tab) });

    // ---- 可展开的输出区 ----
    const body = item.createDiv({ cls: "runner-body" });
    body.style.display = this.expandedIds.has(tab.id) ? "" : "none";

    const outputEl = body.createEl("pre", { cls: "runner-output" });
    outputEl.setText(tab.output || "（无输出）");
    this.outputElMap.set(tab.id, outputEl);
  }

  /** 更新单个展开项的输出文本(含自动滚动) */
  private renderItemOutput(tab: RunnerTab): void {
    const el = this.outputElMap.get(tab.id);
    if (!el) return;

    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    const forceScroll = this.expandScrollId === tab.id;
    el.setText(tab.output || "（无输出）");
    if (this.opts.settings.autoScrollOutput && (forceScroll || nearBottom)) {
      el.scrollTop = el.scrollHeight;
    }
  }

  /**
   * 更新某个项目的状态指示器(圆点颜色 / 状态文字 / 卡片视觉状态)。
   * 不重建 DOM,只修改类名和文本。
   */
  private updateItemStatus(tab: RunnerTab): void {
    const item = this.listEl.querySelector(`[data-id="${tab.id}"]`);
    if (!item) return;

    // 卡片边框/背景
    const card = item.querySelector(".runner-btn-card");
    if (card) {
      card.removeClass("is-running", "is-exited", "is-stopped");
      card.addClass(`is-${tab.status}`);
    }

    // 指示灯
    const dot = item.querySelector(".runner-dot");
    if (dot) {
      dot.removeClass("is-running", "is-exited", "is-stopped");
      dot.addClass(`is-${tab.status}`);
    }

    // 状态文字
    const st = item.querySelector(".runner-status-text");
    if (st) {
      st.setText(this.statusLabel(tab));
      st.removeClass("is-running", "is-exited", "is-stopped");
      st.addClass(`is-${tab.status}`);
    }
  }

  // ---- 交互操作 --------------------------------------------------------------

  private toggleExpand(id: string): void {
    if (this.expandedIds.has(id)) {
      this.expandedIds.delete(id);
    } else {
      this.expandedIds.add(id);
      this.expandScrollId = id;
    }
    this.renderAll();
    if (this.expandedIds.has(id)) {
      const el = this.listEl.querySelector(`[data-id="${id}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  private toggleProcess(tab: RunnerTab): void {
    if (isRunning(tab)) {
      stopProcess(tab, () => this.scheduleRender());
    } else {
      tab.output = "";
      startProcess(tab, () => this.scheduleRender());
    }
    this.renderAll();
  }

  private deleteProcess(id: string): void {
    // 设置支持确认弹窗
    if (this.opts.settings.confirmBeforeDelete) {
      const tab = this.tabs.find((t) => t.id === id);
      if (!tab) return;
      if (!confirm(`确认删除进程「${tab.name}」？`)) return;
    }

    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;

    // 如果正在编辑,先关闭表单
    if (this.formMode === "edit" && this.editingTabId === id) {
      this.clearForm();
    }

    const tab = this.tabs[idx];
    if (tab.child) {
      stopProcess(tab, () => {});
    }

    this.tabs.splice(idx, 1);
    this.expandedIds.delete(id);
    this.outputElMap.delete(id);
    this.saveConfigs();
    this.renderAll();
  }

  // ---- 内联表单(替换弹窗) -------------------------------------------------------

  /** 打开新建表单 */
  private showAddForm(): void {
    if (this.formMode) return;
    this.formMode = "add";
    this.editingTabId = null;
    this.renderForm();
  }

  /** 打开编辑表单 */
  private showEditForm(tab: RunnerTab): void {
    if (this.formMode) return;
    this.formMode = "edit";
    this.editingTabId = tab.id;
    this.renderForm();
    this.renderAll();
  }

  /** 关闭表单,回到正常列表视图 */
  private clearForm(): void {
    this.formMode = null;
    this.editingTabId = null;
    this.formEl.empty();
    this.renderAll();
  }

  /** 渲染内联表单 */
  private renderForm(): void {
    this.formEl.empty();
    const isEdit = this.formMode === "edit";

    const prefill: { name: string; command: string; cwd: string } = {
      name: "",
      command: "",
      cwd: this.opts.defaultCwd,
    };
    if (isEdit && this.editingTabId) {
      const tab = this.tabs.find((t) => t.id === this.editingTabId);
      if (tab) {
        prefill.name = tab.name;
        prefill.command = tab.command;
        prefill.cwd = tab.cwd;
      }
    }

    const panel = this.formEl.createDiv({ cls: `runner-form-panel is-${this.formMode}` });

    // 标题
    const header = panel.createDiv({ cls: "runner-form-header" });
    header.createSpan({ cls: "runner-form-title", text: isEdit ? "编辑进程" : "新建进程" });

    // 表单字段
    const fields = panel.createDiv({ cls: "runner-form-fields" });

    // 名称
    const nameFd = fields.createDiv({ cls: "runner-form-field" });
    nameFd.createDiv({ cls: "runner-form-label", text: "名称" });
    const nameInput = nameFd.createEl("input", {
      cls: "runner-form-input",
      attr: { placeholder: "显示名称", spellcheck: "false" },
    });
    nameInput.value = prefill.name;

    // 命令
    const cmdFd = fields.createDiv({ cls: "runner-form-field" });
    cmdFd.createDiv({ cls: "runner-form-label", text: "命令" });
    const cmdInput = cmdFd.createEl("input", {
      cls: "runner-form-input",
      attr: { placeholder: "如 npm run dev", spellcheck: "false" },
    });
    cmdInput.value = prefill.command;

    // 工作目录
    const cwdFd = fields.createDiv({ cls: "runner-form-field" });
    cwdFd.createDiv({ cls: "runner-form-label", text: "工作目录" });
    const cwdInput = cwdFd.createEl("input", {
      cls: "runner-form-input",
      attr: { placeholder: "默认为 vault 根目录", spellcheck: "false" },
    });
    cwdInput.value = prefill.cwd;

    // 按钮行
    const actions = panel.createDiv({ cls: "runner-form-actions" });

    const cancelBtn = actions.createEl("button", {
      cls: "runner-form-btn is-cancel",
      text: "取消",
    });
    cancelBtn.addEventListener("click", () => this.clearForm());

    const submitBtn = actions.createEl("button", {
      cls: "runner-form-btn is-cta",
      text: isEdit ? "保存" : "运行",
    });
    submitBtn.addEventListener("click", () =>
      this.submitForm(nameInput.value, cmdInput.value, cwdInput.value),
    );

    // 键盘快捷键
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") submitBtn.click();
      if (e.key === "Escape") cancelBtn.click();
    };
    nameInput.addEventListener("keydown", onKey);
    cmdInput.addEventListener("keydown", onKey);
    cwdInput.addEventListener("keydown", onKey);

    // 自动聚焦空字段
    if (!prefill.name) {
      nameInput.focus();
    } else {
      nameInput.focus();
      nameInput.select();
    }
  }

  /** 提交表单 */
  private submitForm(nameRaw: string, cmdRaw: string, cwdRaw: string): void {
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
    const cwd = cwdRaw.trim() || this.opts.defaultCwd;

    if (this.formMode === "edit" && this.editingTabId) {
      const tab = this.tabs.find((t) => t.id === this.editingTabId);
      if (tab) {
        tab.name = name;
        tab.command = command;
        tab.cwd = cwd;
        this.saveConfigs();
      }
    } else {
      const tab = createTab(name, command, cwd);
      this.tabs.push(tab);
      this.saveConfigs();
      startProcess(tab, () => this.scheduleRender());
      this.expandedIds.add(tab.id);
      this.expandScrollId = tab.id;
    }

    this.clearForm();
    this.renderAll();
  }

  // ---- 辅助方法 --------------------------------------------------------------

  private saveConfigs(): void {
    this.opts.onSaveConfigs(
      this.tabs.map((t) => ({
        id: t.id,
        name: t.name,
        command: t.command,
        cwd: t.cwd,
      })),
    );
  }

  private statusLabel(tab: RunnerTab): string {
    if (tab.status === "running") return "运行中";
    if (tab.status === "stopped") return "已停止";
    return `已退出 (${tab.exitCode ?? "?"})`;
  }
}
