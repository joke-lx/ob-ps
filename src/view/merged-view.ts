import { ItemView, MarkdownView, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type { App, CachedMetadata } from "obsidian";
import type { ProcessConfig } from "../types/process";
import type { CommandGroup } from "../types/commands";
import { DEFAULT_SETTINGS, type PluginSettings } from "../types/settings";
import { nextGroupId } from "../settings-tab/group-id";
import {
  appendOutput,
  isRunning,
  resolveOrCreateTab,
  type ProcChangeKind,
  type RunnerTab,
  startProcess,
  stopProcess,
} from "../runner";
import { collectRows, type CollectorSource, type RawLinkEntry } from "../wikilink-inspector/link-collector";
import { partitionByState, type LinkRow } from "../wikilink-inspector/link-row";
import { renderInspectorRow } from "../wikilink-inspector/inspector-render";
import { WikilinkInspectorModal } from "../wikilink-inspector/inspector-modal";
import { flattenWikilinks } from "../wikilink-inspector/flatten-links";
import {
  WliRepairConfirmModal,
  type RepairTabStatus,
} from "../wikilink-inspector/repair-modal";
import { ClearUnresolvedConfirmModal } from "../wikilink-inspector/clear-unresolved-modal";
import {
  collectUnresolvedEdits,
  makeUnresolvedSource,
  groupEditsByPath,
  applyEditsToString,
  type UnresolvedEdit,
} from "../wikilink-inspector/clear-unresolved";
import { ConfirmModal } from "./confirm-modal";
import { setLrIcon } from "./icons";
import {
  renderProcessForm,
  type FormMode,
  type FormPrefill,
  type FormSubmitResult,
} from "./process-form";
import { TreeLinkView } from "../link-tree/link-tree-view";
import type { CreationEvent } from "../link-tree/creation-event";

export const MERGED_VIEW_TYPE = "merged-runner-inspector-view";

const DEFAULT_PREVIEW = 5;
const REFRESH_DEBOUNCE_MS = 400;

export interface MergedViewOptions {
  defaultCwd: string;
  settings: PluginSettings;
  onSaveConfigs: (configs: ProcessConfig[]) => void;
  onSaveCommandGroups: (groups: CommandGroup[]) => void;
  getRepairTabStatus: () => RepairTabStatus;
  onRepairUnresolvedLinks: () => void | Promise<void>;
  /** 返回当前 linkTree 事件列表（由 main.ts 在捕获后更新） */
  getLinkTreeEvents: () => CreationEvent[];
}

export function makeSource(app: App): CollectorSource {
  return {
    listFiles() {
      return app.vault.getMarkdownFiles().map((f) => ({
        path: f.path,
        ctime: f.stat.ctime,
      }));
    },
    getLinks(path) {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return null;
      const cache: CachedMetadata | null = app.metadataCache.getFileCache(file);
      if (!cache) return null;
      const entries: RawLinkEntry[] = [];
      for (const l of cache.links ?? []) {
        entries.push({
          link: l.link,
          position: l.position
            ? { line: l.position.start.line, col: l.position.start.col }
            : undefined,
        });
      }
      for (const l of cache.frontmatterLinks ?? []) {
        entries.push({ link: l.link });
      }
      return entries;
    },
    unresolvedTargets(path) {
      const map = app.metadataCache.unresolvedLinks[path] ?? {};
      return new Set(Object.keys(map));
    },
  };
}

export class MergedRunnerInspectorView extends ItemView {
  // WLI state
  private rows: LinkRow[] = [];
  private readonly limit: Record<"resolved" | "unresolved", number> = {
    resolved: DEFAULT_PREVIEW,
    unresolved: DEFAULT_PREVIEW,
  };
  private readonly collapsed: Record<"resolved" | "unresolved", boolean> = {
    resolved: false,
    unresolved: false,
  };
  private debounceTimer: number | null = null;

  // Runner state
  private tabs: RunnerTab[] = [];
  private readonly expandedIds = new Set<string>();
  private rafScheduled = false;
  private expandScrollId: string | null = null;
  private formMode: FormMode | null = null;
  private editingTabId: string | null = null;
  private readonly outputElMap = new Map<string, HTMLElement>();
  private dragSourceId: string | null = null;

  /** 待应用的配置(onOpen 前收到时暂存) */
  private pendingConfigs: ProcessConfig[] | null = null;

  private readonly opts: MergedViewOptions;

  // DOM 缓存
  private actionsZoneEl!: HTMLElement;
  private procBtnGridEl!: HTMLElement;
  private wliZoneEl!: HTMLElement;
  private wliBodyEl!: HTMLElement;
  private procZoneEl!: HTMLElement;
  private procBodyEl!: HTMLElement;
  private procChevronEl!: HTMLElement;
  private procCollapsed = false;
  private formEl!: HTMLElement;
  /** 完善历史树 */
  private treeView!: TreeLinkView;
  private treeContainerEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, opts: MergedViewOptions) {
    super(leaf);
    this.opts = opts;
    this.treeView = new TreeLinkView((event) => {
      // 跳转到源文件
      void this.openSource({
        sourcePath: event.sourcePath,
        position: event.position,
        target: event.target,
        state: "resolved",
        sourceCtime: event.firstSeenAt,
      });
      // WLI 列表走 400ms 防抖（重算行成本高）
      this.scheduleWliRefresh();
      // 树立刻更新（不防抖），立刻高亮 + 动画到源文件节点
      const newActive = this.getActiveNotePath();
      this.treeView.updateFromApp(this.opts.getLinkTreeEvents(), this.app, newActive);
    });
  }

  getViewType(): string {
    return MERGED_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Local runner";
  }
  getIcon(): string {
    return "link";
  }

  async onOpen(): Promise<void> {
    this.buildUi();
    this.refreshWli();
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => this.scheduleWliRefresh()),
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.scheduleWliRefresh()),
    );
    // 用户切到不同笔记（active leaf 变化）→ 树立即高亮新节点 + 动画
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const newActive = this.getActiveNotePath();
        this.treeView.updateFromApp(this.opts.getLinkTreeEvents(), this.app, newActive);
      }),
    );
    if (this.pendingConfigs) {
      this.setTabsFromConfigs(this.pendingConfigs);
      this.pendingConfigs = null;
    }
  }

  async onClose(): Promise<void> {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    for (const tab of this.tabs) {
      if (tab.child) {
        stopProcess(tab, () => {});
      }
    }
    try { this.treeView.destroy(); } catch { /* ok */ }
  }

  // ---- Public API for main.ts -----------------------------------------------

  setTabsFromConfigs(configs: ProcessConfig[]): void {
    if (!this.procBodyEl) {
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
      generation: 0,
    }));
    this.expandedIds.clear();
    this.outputElMap.clear();
    this.renderProcAll();
  }

  startOrCreateTab(name: string, command: string, cwd: string): RunnerTab {
    const { tab, created } = resolveOrCreateTab(this.tabs, name, command, cwd);
    if (created) {
      this.tabs.push(tab);
      this.expandedIds.add(tab.id);
      this.expandScrollId = tab.id;
      this.saveConfigs();
      this.renderProcAll();
    }
    tab.output = "";
    startProcess(tab, (kind) => this.onProcChange(tab.id, kind));
    return tab;
  }

  findTabByCommand(command: string): RunnerTab | null {
    return this.tabs.find((t) => t.command === command) ?? null;
  }

  /** 展开修复 tab 并滚动到此(替代 revealRunnerTab leaf 切换) */
  revealProcTab(tab: RunnerTab): void {
    this.expandedIds.add(tab.id);
    this.expandScrollId = tab.id;
    this.renderProcAll();
    const el = this.procBodyEl.querySelector(`[data-id="${tab.id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ---- UI Build -------------------------------------------------------------

  private buildUi(): void {
    const root = this.contentEl.createDiv({ cls: "merged-view" });

    // ① Header
    const header = root.createDiv({ cls: "merged-header" });
    header.createSpan({ cls: "merged-title", text: "Local runner" });

    const headerRight = header.createDiv({ cls: "merged-header-right" });

    const refreshBtn = headerRight.createDiv({ cls: "merged-hdr-btn", title: "刷新" });
    setIcon(refreshBtn, "refresh-ccw");
    refreshBtn.addEventListener("click", () => this.refreshWli());

    const allBtn = headerRight.createDiv({ cls: "merged-hdr-btn", title: "弹窗查看全部双链" });
    setIcon(allBtn, "layout-grid");
    allBtn.addEventListener("click", () => {
      new WikilinkInspectorModal(this.app, this.rows).open();
    });

    const settingsBtn = headerRight.createDiv({ cls: "merged-hdr-btn", title: "设置" });
    setIcon(settingsBtn, "gear");
    settingsBtn.addEventListener("click", () => void this.openSettings());

    // ===== Zone 1: 操作区 (30%) =====
    this.actionsZoneEl = root.createDiv({ cls: "merged-zone merged-zone-actions" });

    // 4-col grid: operation buttons
    const grid4 = this.actionsZoneEl.createDiv({ cls: "btn-grid-4" });

    const clearCurBtn = grid4.createDiv({
      cls: "unified-btn",
      title: "将当前笔记的双链转为单链",
    });
    setLrIcon(clearCurBtn, "erase-current");
    clearCurBtn.createSpan({ text: "清除当前" });
    clearCurBtn.addEventListener("click", () => {
      const view = this.getTargetMarkdownView();
      if (!view) {
        new Notice("没有打开的笔记");
        return;
      }
      const count = flattenWikilinks(view.editor);
      new Notice(`已将 ${count} 条双链转为单链`);
    });

    const clearAllBtn = grid4.createDiv({
      cls: "unified-btn",
      title: "将 vault 中全部未解析双链转为单链",
    });
    setLrIcon(clearAllBtn, "erase-all");
    clearAllBtn.createSpan({ text: "清除全部" });
    clearAllBtn.addEventListener("click", () => this.onClearUnresolvedClick());

    const repairBtn = grid4.createDiv({
      cls: "unified-btn",
      title: "通过 Claude 完善未解析双链（补全或创建缺失笔记）",
    });
    setLrIcon(repairBtn, "repair");
    repairBtn.createSpan({ text: "完善" });
    repairBtn.addEventListener("click", () => this.onRepairBtnClick());

    const addProcBtn = grid4.createDiv({
      cls: "unified-btn",
      title: "新建进程",
    });
    setLrIcon(addProcBtn, "new-process");
    addProcBtn.createSpan({ text: "新建进程" });
    addProcBtn.addEventListener("click", () => this.showAddForm());

    // 3-col grid: process quick-buttons (same unified-btn style)
    this.procBtnGridEl = this.actionsZoneEl.createDiv({ cls: "btn-grid-3" });
    this.refreshQuickBar();

    // ③ Form container (beneath zones)
    this.formEl = root.createDiv({ cls: "merged-form-container" });

    // ===== Zone 2: 双链检查 (35%) =====
    this.wliZoneEl = root.createDiv({ cls: "merged-zone merged-zone-wli" });
    this.buildWliSection();

    // ===== Zone 3: 终端输出 (35%) =====
    this.procZoneEl = root.createDiv({ cls: "merged-zone merged-zone-proc" });
    this.buildProcSection();

    // DnD
    this.setupDragEvents();
  }

  // ---- Action Bar -----------------------------------------------------------

  private refreshQuickBar(): void {
    this.procBtnGridEl.empty();
    if (this.tabs.length === 0) return;

    for (const tab of this.tabs) {
      const isRunn = isRunning(tab);
      const isExOk = tab.status === "exited-ok";
      const isExErr = tab.status === "exited-err";
      const statusClass = isRunn
        ? "status-running"
        : isExOk
          ? "status-exited-ok"
          : isExErr
            ? "status-exited-err"
            : "";

      const btn = this.procBtnGridEl.createDiv({
        cls: `unified-btn${statusClass ? " " + statusClass : ""}`,
        title: `${tab.name} — ${isRunn ? "运行中,点击停止" : isExErr ? `已退出(${tab.exitCode}),点击重启` : "已停止,点击启动"}`,
      });

      // Icon row (same icon-above-text pattern as operation buttons)
      const iconRow = btn.createDiv({ cls: "", attr: { style: "display:flex;align-items:center;gap:3px;" } });
      if (isRunn) {
        iconRow.createSpan({ cls: "dot yellow" });
      } else if (isExErr) {
        iconRow.createSpan({ cls: "dot red" });
      } else {
        iconRow.createSpan({ cls: "dot gray" });
      }

      btn.createSpan({ text: tab.name });

      btn.addEventListener("click", () => {
        this.toggleProcess(tab);
      });
    }
  }

  // ---- WLI ------------------------------------------------------------------

  private buildWliSection(): void {
    const head = this.wliZoneEl.createDiv({ cls: "zone-head" });
    const chevron = head.createDiv({ cls: "zone-head-cv" });
    setIcon(chevron, "chevron-down");
    head.createSpan({ cls: "zone-head-title", text: "双链检查" });

    // 完善历史树 canvas（容错：如果挂载失败不阻止其余 UI）
    this.treeContainerEl = this.wliZoneEl.createDiv({
      cls: "wli-tree-container",
      attr: { style: "min-height:120px;max-height:360px;width:100%" },
    });
    try {
      this.treeView.mount(this.treeContainerEl);
    } catch (e) {
      console.warn("[link-tree] mount failed", e);
    }

    this.wliBodyEl = this.wliZoneEl.createDiv({ cls: "zone-wli-body" });
  }

  private refreshWli(): void {
    this.rows = collectRows(makeSource(this.app));
    this.renderWliAll();
    // 更新完善历史树
    try {
      const events = this.opts.getLinkTreeEvents();
      if (events.length || this.treeContainerEl?.isConnected) {
        const activePath = this.getActiveNotePath();
        console.log("[link-tree] refreshWli => update", { events: events.length, activePath });
        this.treeView.updateFromApp(events, this.app, activePath);
      }
    } catch (e) {
      console.warn("[link-tree] update failed", e);
    }
  }

  private scheduleWliRefresh(): void {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.refreshWli();
    }, REFRESH_DEBOUNCE_MS);
  }

  private renderWliAll(): void {
    this.wliBodyEl.empty();
    const { unresolved } = partitionByState(this.rows);

    // Update zone title with count
    const titleEl = this.wliZoneEl.querySelector(".zone-head-title");
    if (titleEl) {
      titleEl.setText(`双链检查 (${this.rows.length})`);
    }

    this.renderWliGroup("unresolved", "未解析", unresolved);
    // this.renderWliGroup("resolved", "已解析", resolved);
  }

  private renderWliGroup(
    key: "resolved" | "unresolved",
    label: string,
    rows: LinkRow[],
  ): void {
    if (key === "unresolved" && rows.length === 0) {
      return;
    }

    const section = this.wliBodyEl.createDiv({
      cls: `wli-sub is-${key}${this.collapsed[key] ? " is-collapsed" : ""}`,
    });

    const head = section.createDiv({ cls: "wli-sub-head" });
    const chevron = head.createDiv({ cls: "wli-sub-head-cv" });
    setIcon(chevron, this.collapsed[key] ? "chevron-right" : "chevron-down");
    head.createSpan({ cls: "wli-sub-head-title", text: `${label} (${rows.length})` });

    head.addEventListener("click", () => {
      this.collapsed[key] = !this.collapsed[key];
      this.renderWliAll();
    });

    const body = section.createDiv({ cls: "wli-sub-body" });

    const shown = rows.slice(0, this.limit[key]);
    for (const r of shown) {
      renderInspectorRow(body, r, (row) => void this.openSource(row));
    }

    if (rows.length > this.limit[key]) {
      const more = body.createDiv({
        cls: "wli-load-more",
        text: `加载更多 +${DEFAULT_PREVIEW}（剩 ${rows.length - this.limit[key]}）`,
      });
      more.addEventListener("click", () => {
        this.limit[key] += DEFAULT_PREVIEW;
        this.renderWliAll();
      });
    }
  }

  /** 修复按钮点击 —— 开确认弹窗 */
  private onRepairBtnClick(): void {
    const status = this.opts.getRepairTabStatus();
    new WliRepairConfirmModal(this.app, status, {
      onLaunch: () => {
        void this.opts.onRepairUnresolvedLinks();
      },
      onReveal: () => {
        // 找到修复 tab 并展开(替代旧 revealRunnerTab leaf 切换)
        const tab = this.findTabByCommand(
          "claude --dangerously-skip-permissions -p \"/obsidian-repair-unresolved-links\"",
        );
        if (tab) {
          this.expandedIds.add(tab.id);
          this.renderProcAll();
        }
      },
    }).open();
  }

  // ---- 清除未解析双链 ---------------------------------------------------------

  private onClearUnresolvedClick(): void {
    const edits = collectUnresolvedEdits(makeUnresolvedSource(this.app));
    if (edits.length === 0) {
      new Notice("没有未解析双链");
      return;
    }
    new ClearUnresolvedConfirmModal(this.app, edits.length, {
      onConfirm: () => void this.runClearUnresolved(edits),
    }).open();
  }

  private async runClearUnresolved(edits: UnresolvedEdit[]): Promise<void> {
    const byPath = groupEditsByPath(edits);
    let totalApplied = 0;
    for (const [path, group] of byPath) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      const original = await this.app.vault.cachedRead(file);
      const bomStripped = original.charCodeAt(0) === 0xfeff ? original.slice(1) : original;
      const { result, applied } = applyEditsToString(bomStripped, group);
      if (applied === 0) continue;
      await this.app.vault.modify(file, result);
      totalApplied += applied;
    }
    new Notice(`已清除 ${totalApplied} 条未解析双链`);
  }

  // ---- 进程日志 Section ------------------------------------------------------

  private buildProcSection(): void {
    const head = this.procZoneEl.createDiv({ cls: "zone-head" });
    const chevron = head.createDiv({ cls: "zone-head-cv" });
    setIcon(chevron, "chevron-down");
    head.createSpan({ cls: "zone-head-title", text: "终端输出" });
    this.procChevronEl = chevron;

    this.procBodyEl = this.procZoneEl.createDiv({ cls: "zone-proc-body" });

    head.addEventListener("click", () => {
      this.procCollapsed = !this.procCollapsed;
      setIcon(this.procChevronEl, this.procCollapsed ? "chevron-right" : "chevron-down");
      this.procBodyEl.toggleClass("is-collapsed", this.procCollapsed);
    });
  }

  /**
   * runner 回调统一入口:
   * - "status": 状态/句柄变化 —— 立即全量重渲(边框/状态点/顶部快速栏)
   * - "data":   文本流追加 —— 进 RAF 节流,只 patch 已展开 tab 的输出
   *
   * status 用同步重渲(发生频率极低),data 用 RAF(高频时一帧一次)。
   * 原因:status 变化意味着 CSS class 集合改变,必须重建 DOM;
   *       data 只是同 buffer 追加,保留滚动位置/避免抖动至关重要。
   */
  private onProcChange(tabId: string, kind: ProcChangeKind): void {
    if (kind === "status") {
      this.renderProcAll();
      return;
    }
    this.scheduleProcRender(tabId);
  }

  private scheduleProcRender(_changedTabId: string): void {
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    window.requestAnimationFrame(() => {
      this.rafScheduled = false;
      for (const tab of this.tabs) {
        if (!this.expandedIds.has(tab.id)) continue;
        const outputEl = this.outputElMap.get(tab.id);
        if (!outputEl) continue;
        outputEl.setText(tab.output || "");
        const nearBottom =
          outputEl.scrollHeight - outputEl.scrollTop - outputEl.clientHeight < 30;
        if (this.expandScrollId === tab.id || nearBottom) {
          outputEl.scrollTop = outputEl.scrollHeight;
        }
      }
      this.expandScrollId = null;
    });
  }

  private renderProcAll(): void {
    this.procBodyEl.empty();
    this.outputElMap.clear();
    this.refreshQuickBar();

    const titleEl = this.procZoneEl.querySelector(".zone-head-title");
    if (titleEl) {
      titleEl.setText(`终端输出 (${this.tabs.length})`);
    }

    if (this.tabs.length === 0 && !this.formMode) {
      this.procBodyEl.createDiv({
        cls: "proc-empty",
        text: "暂无进程,点击 + 新建进程 添加",
      });
      return;
    }

    for (const tab of this.tabs) {
      if (this.formMode === "edit" && tab.id === this.editingTabId) continue;
      const { outputEl } = this.renderProcCard(tab);
      this.outputElMap.set(tab.id, outputEl);
    }
  }

  /** 渲染单个进程日志卡片（仅查看输出，无操作按钮） */
  private renderProcCard(tab: RunnerTab): { outputEl: HTMLElement } {
    const isRunn = isRunning(tab);
    const isExOk = tab.status === "exited-ok";
    const isExErr = tab.status === "exited-err";
    const isExpanded = this.expandedIds.has(tab.id);

    const statusClass = isRunn ? "status-running" : isExOk ? "status-exited-ok" : isExErr ? "status-exited-err" : "status-stopped";

    const item = this.procBodyEl.createDiv({ cls: "proc-item" });
    item.setAttr("data-id", tab.id);
    item.setAttr("draggable", "true");

    const card = item.createDiv({
      cls: `proc-card ${statusClass}`,
    });

    // 状态指示点
    card.createDiv({ cls: `proc-dot ${statusClass}` });

    // 进程名
    card.createSpan({ cls: "proc-name", text: tab.name });

    // 状态文字 (颜色由 CSS 类 .proc-status.status-* 提供, 不再内联 style)
    const statusText = isRunn ? "运行中" : isExOk ? "正常退出" : isExErr ? `异常退出 (${tab.exitCode})` : "已停止";
    card.createSpan({
      cls: `proc-status ${statusClass}`,
      text: statusText,
    });

    // 展开/收起箭头
    const expandIcon = card.createDiv({ cls: "proc-expand" });
    setIcon(expandIcon, isExpanded ? "chevron-up" : "chevron-down");

    // 卡片点击 = toggle 日志
    card.addEventListener("click", () => this.toggleProcExpand(tab.id));

    // 日志输出区
    const body = item.createDiv({
      cls: `proc-body${isExpanded ? "" : " is-collapsed"}`,
    });
    const outputEl = body.createDiv({ cls: "proc-output" });
    if (tab.output) {
      outputEl.setText(tab.output);
    } else {
      outputEl.createSpan({ cls: "proc-output-empty", text: "暂无输出" });
    }

    if (isExpanded && this.expandScrollId === tab.id) {
      item.scrollIntoView({ behavior: "smooth", block: "nearest" });
      this.expandScrollId = null;
    }

    return { outputEl };
  }

  private toggleProcExpand(id: string): void {
    if (this.expandedIds.has(id)) {
      this.expandedIds.delete(id);
    } else {
      this.expandedIds.add(id);
      this.expandScrollId = id;
    }
    this.renderProcAll();
  }

  // ---- 进程操作 (启停编辑删除) ------------------------------------------------

  private toggleProcess(tab: RunnerTab): void {
    if (isRunning(tab)) {
      stopProcess(tab, (kind) => this.onProcChange(tab.id, kind));
    } else if (tab.status === "stopped") {
      tab.output = "";
      startProcess(tab, (kind) => this.onProcChange(tab.id, kind));
    } else {
      tab.output = "";
      tab.status = "stopped";
      tab.exitCode = null;
      appendOutput(tab, "\n[已重置]\n");
      this.renderProcAll();
    }
  }

  // ---- 删除进程 --------------------------------------------------------------

  private deleteProcess(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    new ConfirmModal(this.app, `确认删除进程「${tab.name}」？`, () => {
      this.doDeleteProcess(id);
    }).open();
  }

  private doDeleteProcess(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    if (this.formMode === "edit" && this.editingTabId === id) {
      this.clearForm();
    }
    const tab = this.tabs[idx];
    if (tab.child) {
      stopProcess(tab, (kind) => this.onProcChange(tab.id, kind));
    }
    this.tabs.splice(idx, 1);
    this.expandedIds.delete(id);
    this.outputElMap.delete(id);
    this.saveConfigs();
    this.renderProcAll();
  }

  // ---- 内联表单(新建/编辑进程) -----------------------------------------------

  private showAddForm(): void {
    if (this.formMode) return;
    this.formMode = "add";
    this.editingTabId = null;
    this.renderForm();
  }

  private showEditForm(tab: RunnerTab): void {
    if (this.formMode) return;
    this.formMode = "edit";
    this.editingTabId = tab.id;
    this.renderForm();
    this.renderProcAll();
  }

  private clearForm(): void {
    this.formMode = null;
    this.editingTabId = null;
    this.formEl.empty();
    this.renderProcAll();
  }

  private renderForm(): void {
    if (!this.formMode) return;
    const isEdit = this.formMode === "edit";
    const editingTab = isEdit && this.editingTabId
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
      onSaveToGroup: (entry) => this.handleSaveToGroup(entry),
    });
  }

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
      startProcess(result.tab, (kind) => this.onProcChange(result.tab.id, kind));
    }
    this.expandedIds.add(result.tab.id);
    this.expandScrollId = result.tab.id;
    this.saveConfigs();
    this.clearForm();
  }

  private handleSaveToGroup(entry: { name: string; command: string; cwd: string }): void {
    const groups = this.opts.settings.commandGroups ?? [];
    const cmd = entry.command.trim();
    const dup = groups.find((g) => g.command.trim() === cmd);
    if (dup) {
      new Notice(`命令组「${dup.name}」已存在该命令,未重复添加`);
      return;
    }
    const next: CommandGroup[] = [
      ...groups,
      {
        id: nextGroupId(),
        name: entry.name.trim(),
        command: cmd,
        cwd: entry.cwd.trim(),
      },
    ];
    this.opts.settings.commandGroups = next;
    this.opts.onSaveCommandGroups(next);
    new Notice(`已加入命令组「${entry.name}」`);
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

  private async openSettings(): Promise<void> {
    const app = this.app as unknown as {
      setting: { open(): Promise<void>; openTabById(id: string): void };
    };
    await app.setting.open();
    app.setting.openTabById("local-runner");
  }

  private getTargetMarkdownView(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) return active;
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (leaf.view instanceof MarkdownView) return leaf.view;
    }
    return null;
  }

  /** 当前打开笔记的路径（用于作用域过滤） */
  private getActiveNotePath(): string | null {
    return this.getTargetMarkdownView()?.file?.path ?? null;
  }

  private async openSource(row: LinkRow): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(row.sourcePath);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const view = leaf.view;
    if (row.position && view instanceof MarkdownView) {
      const { line, col } = row.position;
      view.editor.setCursor({ line, ch: col });
      view.editor.scrollIntoView(
        { from: { line, ch: 0 }, to: { line, ch: 0 } },
        true,
      );
    }
  }

  // ---- 拖拽排序 (HTML5 DnD) --------------------------------------------------

  private setupDragEvents(): void {
    this.procBodyEl.addEventListener("dragstart", (e: DragEvent) => {
      const card = (e.target as HTMLElement).closest(".proc-card");
      if (!card) { e.preventDefault(); return; }
      const item = card.closest<HTMLElement>(".proc-item");
      if (!item) { e.preventDefault(); return; }
      const id = item.dataset.id;
      if (!id) { e.preventDefault(); return; }
      this.dragSourceId = id;
      e.dataTransfer?.setData("text/plain", id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      item.addClass("is-dragging");
    });

    this.procBodyEl.addEventListener("dragend", () => {
      this.cleanDragState();
      this.dragSourceId = null;
    });

    this.procBodyEl.addEventListener("dragover", (e: DragEvent) => {
      e.preventDefault();
      const item = (e.target as HTMLElement).closest<HTMLElement>(".proc-item");
      if (!item) return;
      this.procBodyEl.querySelectorAll(".is-drag-over").forEach((el) =>
        el.removeClass("is-drag-over"),
      );
      item.addClass("is-drag-over");
    });

    this.procBodyEl.addEventListener("dragleave", (e: DragEvent) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>(".proc-item");
      if (!item) return;
      const related = e.relatedTarget as HTMLElement | null;
      if (related && item.contains(related)) return;
      item.removeClass("is-drag-over");
    });

    this.procBodyEl.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault();
      const draggedId = e.dataTransfer?.getData("text/plain") ?? this.dragSourceId;
      const targetItem = (e.target as HTMLElement).closest<HTMLElement>(".proc-item");
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
      this.renderProcAll();
    });
  }

  private cleanDragState(): void {
    this.procBodyEl?.querySelectorAll(".is-dragging, .is-drag-over").forEach((el) =>
      (el as HTMLElement).removeClass("is-dragging", "is-drag-over"),
    );
  }
}

export { DEFAULT_SETTINGS };
