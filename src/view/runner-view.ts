import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type { ProcessConfig } from "../types/process";
import { DEFAULT_SETTINGS, type PluginSettings } from "../types/settings";
import {
  isRunning,
  resolveOrCreateTab,
  type RunnerTab,
  startProcess,
  stopProcess,
} from "../runner";
import { ConfirmModal } from "./confirm-modal";
import {
  renderProcessForm,
  type FormMode,
  type FormPrefill,
  type FormSubmitResult,
} from "./process-form";
import {
  renderProcessItem,
  updateProcessItemOutput,
  updateProcessItemStatus,
} from "./process-item";

export const RUNNER_VIEW_TYPE = "local-runner-view";

export interface ViewOptions {
  defaultCwd: string;
  settings: PluginSettings;
  onSaveConfigs: (configs: ProcessConfig[]) => void;
  /** 顶栏「双链」按钮：切到双链检查视图 */
  onOpenInspector: () => void;
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
  private formMode: FormMode | null = null;
  /** edit 模式时,正在编辑的标签页 ID */
  private editingTabId: string | null = null;

  // DOM 缓存
  private listEl!: HTMLElement;
  private formEl!: HTMLElement;
  private readonly outputElMap = new Map<string, HTMLElement>();

  // ---- DnD 拖拽排序状态 ----
  private dragSourceId: string | null = null;

  getViewType(): string {
    return RUNNER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "本地进程";
  }

  getIcon(): string {
    return "play";
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

  /**
   * Host 接口实现:若 command 已存在则复用并启动;否则新建并启动。
   * 不切换视图;复用时不修改原 tab 的 cwd。
   */
  startOrCreateTab(name: string, command: string, cwd: string): RunnerTab {
    const { tab, created } = resolveOrCreateTab(this.tabs, name, command, cwd);
    if (created) {
      this.tabs.push(tab);
      this.expandedIds.add(tab.id);
      this.expandScrollId = tab.id;
      this.saveConfigs();
      this.renderAll();
    }
    // 复用与新建均启动 —— startProcess 内部幂等（已在运行时则早退）
    tab.output = "";
    startProcess(tab, () => this.scheduleRender());
    return tab;
  }

  /** Host 接口实现:按 command 查找标签页;不存在返回 null */
  findTabByCommand(command: string): RunnerTab | null {
    return this.tabs.find((t) => t.command === command) ?? null;
  }

  // ---- UI Build -------------------------------------------------------------

  private buildUi(): void {
    const root = this.contentEl.createDiv({ cls: "runner-view" });

    // 头部:标题 + 设置按钮
    const header = root.createDiv({ cls: "runner-header" });
    header.createSpan({ cls: "runner-header-title", text: "本地进程管理" });

    const headerRight = header.createDiv({ cls: "runner-header-right" });

    const inspectorBtn = headerRight.createDiv({
      cls: "runner-header-btn",
      title: "双链检查",
    });
    setIcon(inspectorBtn, "link");
    inspectorBtn.addEventListener("click", () => this.opts.onOpenInspector());

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

    // 拖拽排序事件
    this.setupDragEvents();
  }

  /** 打开 Obsidian 设置 → Local Runner 标签页 */
  private async openSettings(): Promise<void> {
    const app = this.app as unknown as {
      setting: { open(): Promise<void>; openTabById(id: string): void };
    };
    await app.setting.open();
    app.setting.openTabById("local-runner");
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
        const item = this.listEl.querySelector<HTMLElement>(`[data-id="${tab.id}"]`);
        if (!item) continue;
        updateProcessItemStatus(item, tab);
        if (this.expandedIds.has(tab.id)) {
          const outputEl = this.outputElMap.get(tab.id);
          if (outputEl) {
            updateProcessItemOutput(
              outputEl,
              tab,
              this.expandScrollId === tab.id,
            );
          }
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
      const { outputEl } = renderProcessItem(this.listEl, tab, {
        expanded: this.expandedIds.has(tab.id),
        onCardClick: (t) => this.toggleProcess(t),
        onToggleExpand: (id) => this.toggleExpand(id),
        onEdit: (t) => this.showEditForm(t),
        onDelete: (id) => this.deleteProcess(id),
      });
      this.outputElMap.set(tab.id, outputEl);
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

  /** 删除进程:先弹确认,确认后才真正执行 */
  private deleteProcess(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    new ConfirmModal(this.app, `确认删除进程「${tab.name}」？`, () => {
      this.doDeleteProcess(id);
    }).open();
  }

  /** 真正执行删除(已通过 ConfirmModal 确认) */
  private doDeleteProcess(id: string): void {
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
    if (!this.formMode) return;
    const isEdit = this.formMode === "edit";
    const editingTab =
      isEdit && this.editingTabId
        ? this.tabs.find((t) => t.id === this.editingTabId) ?? null
        : null;

    const prefill: FormPrefill = {
      name: editingTab?.name ?? "",
      command: editingTab?.command ?? "",
      cwd: editingTab?.cwd ?? this.opts.defaultCwd,
    };

    renderProcessForm(this.formEl, {
      mode: this.formMode,
      editingTab,
      prefill,
      commandGroups: this.opts.settings.commandGroups ?? [],
      defaultCwd: this.opts.defaultCwd,
      onSubmit: (result) => this.handleFormSubmit(result),
    });
  }

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

  // ---- 拖拽排序 (HTML5 DnD) --------------------------------------------------

  /** 在 listEl 上绑定一次 DnD 事件委托 */
  private setupDragEvents(): void {
    this.listEl.addEventListener("dragstart", (e: DragEvent) => {
      const card = (e.target as HTMLElement).closest(".runner-btn-card");
      if (!card) { e.preventDefault(); return; }
      const item = card.closest<HTMLElement>(".runner-item");
      if (!item) { e.preventDefault(); return; }
      const id = item.dataset.id;
      if (!id) { e.preventDefault(); return; }

      this.dragSourceId = id;
      e.dataTransfer?.setData("text/plain", id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      item.addClass("is-dragging");
    });

    this.listEl.addEventListener("dragend", () => {
      this.cleanDragState();
      this.dragSourceId = null;
    });

    this.listEl.addEventListener("dragover", (e: DragEvent) => {
      e.preventDefault(); // 允许 drop
      const item = (e.target as HTMLElement).closest<HTMLElement>(".runner-item");
      if (!item) return;
      // 切换拖拽高亮至当前悬停的卡片
      this.listEl.querySelectorAll(".is-drag-over").forEach((el) =>
        el.removeClass("is-drag-over"),
      );
      item.addClass("is-drag-over");
    });

    this.listEl.addEventListener("dragleave", (e: DragEvent) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>(".runner-item");
      if (!item) return;
      // 进入子元素时不取消高亮
      const related = e.relatedTarget as HTMLElement | null;
      if (related && item.contains(related)) return;
      item.removeClass("is-drag-over");
    });

    this.listEl.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault();
      const draggedId = e.dataTransfer?.getData("text/plain") ?? this.dragSourceId;
      const targetItem =
        (e.target as HTMLElement).closest<HTMLElement>(".runner-item");
      if (!draggedId || !targetItem) return;
      const targetId = targetItem.dataset.id;
      if (!targetId || draggedId === targetId) return;

      const fromIdx = this.tabs.findIndex((t) => t.id === draggedId);
      const toIdx = this.tabs.findIndex((t) => t.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return;

      const [moved] = this.tabs.splice(fromIdx, 1);
      const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
      this.tabs.splice(adjustedTo, 0, moved);

      this.cleanDragState();
      this.dragSourceId = null;
      this.saveConfigs();
      this.renderAll();
    });
  }

  /** 清除所有 DnD 相关的 class */
  private cleanDragState(): void {
    this.listEl?.querySelectorAll(".is-dragging, .is-drag-over").forEach((el) =>
      (el as HTMLElement).removeClass("is-dragging", "is-drag-over"),
    );
  }
}

/** 重导出默认设置,保持 `view` 导入路径的兼容性 */
export { DEFAULT_SETTINGS };