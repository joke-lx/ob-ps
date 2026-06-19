import { ItemView, Modal, Notice, Setting, WorkspaceLeaf, setIcon } from "obsidian";
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

export interface ViewOptions {
  defaultCwd: string;
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

  // DOM 缓存
  private listEl!: HTMLElement;
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

  // ---- UI Build -------------------------------------------------------------

  private buildUi(): void {
    const root = this.contentEl.createDiv({ cls: "runner-view" });

    // 头部:标题 + 新建按钮
    const header = root.createDiv({ cls: "runner-header" });
    header.createSpan({ cls: "runner-header-title", text: "本地进程管理" });
    const addBtn = header.createDiv({ cls: "runner-add-btn", title: "新建进程" });
    setIcon(addBtn, "plus");
    addBtn.addEventListener("click", () => this.openProcessModal());

    // 进程列表
    this.listEl = root.createDiv({ cls: "runner-list" });
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

    if (this.tabs.length === 0) {
      this.listEl.createDiv({
        cls: "runner-empty",
        text: "暂无进程,点击 ＋ 添加",
      });
      return;
    }

    for (const tab of this.tabs) {
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
      this.openEditModal(tab);
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
    if (forceScroll || nearBottom) {
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
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;

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

  // ---- 弹窗 ----------------------------------------------------------------

  private openProcessModal(): void {
    new ProcessModal(this.app, this.opts.defaultCwd, (cfg) => {
      const tab = createTab(cfg.name, cfg.command, cfg.cwd);
      this.tabs.push(tab);
      this.saveConfigs();
      startProcess(tab, () => this.scheduleRender());
      this.expandedIds.add(tab.id);
      this.expandScrollId = tab.id;
      this.renderAll();
    }).open();
  }

  private openEditModal(tab: RunnerTab): void {
    new ProcessModal(
      this.app,
      this.opts.defaultCwd,
      (cfg) => {
        tab.name = cfg.name;
        tab.command = cfg.command;
        tab.cwd = cfg.cwd;
        this.saveConfigs();
        this.renderAll();
      },
      { name: tab.name, command: tab.command, cwd: tab.cwd },
    ).open();
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

// ---- 新建/编辑进程弹窗 ------------------------------------------------------

interface ModalConfig {
  name?: string;
  command?: string;
  cwd?: string;
}

class ProcessModal extends Modal {
  private name = "";
  private command = "";
  private cwd = "";
  private readonly defaultCwd: string;
  private readonly onSubmit: (cfg: { name: string; command: string; cwd: string }) => void;

  constructor(
    app: import("obsidian").App,
    defaultCwd: string,
    onSubmit: (cfg: { name: string; command: string; cwd: string }) => void,
    existing?: ModalConfig,
  ) {
    super(app);
    this.defaultCwd = defaultCwd;
    this.onSubmit = onSubmit;
    this.name = existing?.name ?? "";
    this.command = existing?.command ?? "";
    this.cwd = existing?.cwd ?? defaultCwd;
  }

  onOpen(): void {
    const isEdit = !!this.name;
    this.titleEl.setText(isEdit ? "编辑进程" : "新建进程");

    // 名称
    new Setting(this.contentEl)
      .setName("名称")
      .setDesc("显示名称")
      .addText((t) => {
        t.setValue(this.name).onChange((v) => (this.name = v));
        if (!isEdit) t.inputEl.focus();
      });

    // 命令
    new Setting(this.contentEl)
      .setName("命令")
      .setDesc("任意 shell 命令,如 npm run dev")
      .addText((t) => {
        t.setValue(this.command).onChange((v) => (this.command = v));
        t.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") this.submit();
        });
      });

    // 工作目录
    new Setting(this.contentEl)
      .setName("工作目录")
      .setDesc("默认为 vault 根目录")
      .addText((t) => {
        t.setValue(this.cwd).onChange((v) => (this.cwd = v));
        t.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") this.submit();
        });
      });

    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText(isEdit ? "保存" : "运行")
        .setCta()
        .onClick(() => this.submit()),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private submit(): void {
    const name = this.name.trim();
    const command = this.command.trim();
    if (!name) {
      new Notice("请输入名称");
      return;
    }
    if (!command) {
      new Notice("请输入命令");
      return;
    }
    const cwd = this.cwd.trim() || this.defaultCwd;
    this.close();
    this.onSubmit({ name, command, cwd });
  }
}
