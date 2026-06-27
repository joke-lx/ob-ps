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
import { ClearUnresolvedConfirmModal } from "../wikilink-inspector/clear-unresolved-modal";
import { makeUnresolvedSource } from "../wikilink-inspector/clear-unresolved";
import type { RepairTabStatus } from "../wikilink-inspector/repair-modal";
import { ConfirmModal } from "./confirm-modal";
import {
  renderProcessForm,
  type FormMode,
  type FormPrefill,
  type FormSubmitResult,
} from "./process-form";

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
}

function makeSource(app: App): CollectorSource {
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
  private wliChevronEl!: HTMLElement;
  private wliCollapsed = false;
  private procZoneEl!: HTMLElement;
  private procBodyEl!: HTMLElement;
  private procChevronEl!: HTMLElement;
  private procCollapsed = false;
  private logSectionVisible = false;
  private logBtnEl!: HTMLElement;
  private formEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, opts: MergedViewOptions) {
    super(leaf);
    this.opts = opts;
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

    const settingsBtn = headerRight.createDiv({ cls: "clickable-icon", title: "设置" });
    setIcon(settingsBtn, "gear");
    settingsBtn.addEventListener("click", () => void this.openSettings());

    // ===== Zone 1: 进程快捷操作 (auto-size) =====
    this.actionsZoneEl = root.createDiv({ cls: "merged-zone merged-zone-actions" });

    // Process quick-bar (flex-wrap, auto-sized)
    this.procBtnGridEl = this.actionsZoneEl.createDiv({ cls: "btn-process-bar" });
    this.refreshQuickBar();

    // Utility row: log toggle only
    const utilityRow = this.actionsZoneEl.createDiv({ cls: "proc-utility-row" });

    this.logBtnEl = utilityRow.createDiv({ cls: "proc-util-btn", title: "查看日志" });
    setIcon(this.logBtnEl, "terminal");
    this.logBtnEl.createSpan({ text: "日志" });
    this.logBtnEl.addEventListener("click", () => this.toggleLogSection());

    // ③ Form container (beneath zones)
    this.formEl = root.createDiv({ cls: "merged-form-container" });

    // ===== Zone 2: 双链检查 (fills remaining space) =====
    this.wliZoneEl = root.createDiv({ cls: "merged-zone merged-zone-wli" });
    this.buildWliSection();

    // ===== Zone 3: 终端输出 (hidden by default) =====
    this.procZoneEl = root.createDiv({ cls: "merged-zone merged-zone-proc is-collapsed" });
    this.buildProcSection();

    // DnD
    this.setupDragEvents();
  }

  // ---- Action Bar -----------------------------------------------------------

  private refreshQuickBar(): void {
    this.procBtnGridEl.empty();
    const groups = this.opts.settings.commandGroups ?? [];
    const visible = groups.filter((g) => g.visible !== false);
    if (visible.length === 0) return;

    for (const group of visible) {
      // Find matching process tab (by command)
      const tab = this.tabs.find((t) => t.command === group.command);
      const isRunn = tab ? isRunning(tab) : false;
      const isExErr = tab ? tab.status === "exited-err" : false;

      const btn = this.procBtnGridEl.createDiv({
        cls: `proc-quick-btn${isRunn ? " status-running" : isExErr ? " status-exited-err" : ""}`,
        title: `${group.name}${tab ? " — " + (isRunn ? "运行中,点击停止" : isExErr ? "已退出,点击重启" : "已停止,点击启动") : " — 点击启动"}`,
      });

      // Status dot
      if (isRunn) {
        btn.createSpan({ cls: "dot yellow" });
      } else if (isExErr) {
        btn.createSpan({ cls: "dot red" });
      } else if (tab) {
        btn.createSpan({ cls: "dot gray" });
      } else {
        // No matching tab yet — show "ready" dot
        btn.createSpan({ cls: "dot gray" });
      }

      btn.createSpan({ text: group.name });

      btn.addEventListener("click", () => {
        if (tab) {
          this.toggleProcess(tab);
        } else {
          this.startOrCreateTab(group.name, group.command, group.cwd || this.opts.defaultCwd);
        }
      });
    }
  }

  // ---- WLI ------------------------------------------------------------------

  private buildWliSection(): void {
    const head = this.wliZoneEl.createDiv({ cls: "zone-head" });
    const chevron = head.createDiv({ cls: "zone-head-cv" });
    setIcon(chevron, "chevron-down");
    head.createSpan({ cls: "zone-head-title", text: "未解析双链" });
    this.wliChevronEl = chevron;

    // 清除全部按钮:把 [[x]] 转成 [x] 语法清除
    const clearBtn = head.createDiv({
      cls: "wli-action-btn",
      title: "将所有未解析 [[x]] 转成 [x] (清除未解析状态)",
    });
    setIcon(clearBtn, "eraser");
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onClearUnresolvedClick();
    });
    head.appendChild(clearBtn);

    this.wliBodyEl = this.wliZoneEl.createDiv({ cls: "zone-wli-body" });

    head.addEventListener("click", () => {
      this.wliCollapsed = !this.wliCollapsed;
      setIcon(this.wliChevronEl, this.wliCollapsed ? "chevron-right" : "chevron-down");
      this.wliBodyEl.toggleClass("is-collapsed", this.wliCollapsed);
      this.wliZoneEl.toggleClass("is-shrunk", this.wliCollapsed);
    });
  }

  private refreshWli(): void {
    this.rows = collectRows(makeSource(this.app));
    this.renderWliAll();
  }

  /** 清除未解析双链:[[x]] → [x] 语法清除(基于正则 + unresolved 过滤) */
  private onClearUnresolvedClick(): void {
    const unresolved = makeUnresolvedSource(this.app);
    const allFiles = unresolved.listMarkdownFiles();
    if (allFiles.length === 0) {
      new Notice("没有可处理的文件");
      return;
    }

    // 先统计总条数
    let totalCount = 0;
    for (const f of allFiles) {
      const links = unresolved.getFileLinks(f.path);
      if (!links) continue;
      const set = unresolved.getUnresolvedTargets(f.path);
      totalCount += links.filter((l) => set.has(l.link)).length;
    }
    if (totalCount === 0) {
      new Notice("没有未解析双链");
      return;
    }

    new ClearUnresolvedConfirmModal(this.app, totalCount, {
      onConfirm: () => void this.runClearUnresolved(),
    }).open();
  }

  /**
   * 实际替换:用正则匹配每个文件中的 [[...]],只替换 unresolved 列表里的 target。
   * 不依赖 metadataCache.position 的 start/end offset,避开 0/1-based 与 inclusive/exclusive 歧义。
   */
  private async runClearUnresolved(): Promise<void> {
    const source = makeUnresolvedSource(this.app);
    const linkRegex = /\[\[([^\]\n]+)\]\]/g;
    let totalApplied = 0;
    let filesTouched = 0;

    for (const f of source.listMarkdownFiles()) {
      const unresolvedSet = source.getUnresolvedTargets(f.path);
      if (unresolvedSet.size === 0) continue;

      const file = this.app.vault.getAbstractFileByPath(f.path);
      if (!(file instanceof TFile)) continue;

      const original = await this.app.vault.cachedRead(file);
      const text = original.charCodeAt(0) === 0xfeff ? original.slice(1) : original;

      // 收集这个文件中所有未解析双链的替换操作
      const ops: { offset: number; len: number; replacement: string }[] = [];
      let m: RegExpExecArray | null;
      linkRegex.lastIndex = 0;
      while ((m = linkRegex.exec(text)) !== null) {
        const inside = m[1];
        // 取 target(处理 alias [[a|b]])
        const pipeIdx = inside.indexOf("|");
        const target = (pipeIdx >= 0 ? inside.slice(0, pipeIdx) : inside).trim();
        if (!unresolvedSet.has(target)) continue;
        const replacement = "[" + (pipeIdx >= 0 ? inside.slice(pipeIdx + 1) : inside) + "]";
        ops.push({ offset: m.index, len: m[0].length, replacement });
      }

      if (ops.length === 0) continue;

      // 降序替换,避免偏移漂移
      ops.sort((a, b) => b.offset - a.offset);
      let out = text;
      for (const o of ops) {
        out = out.slice(0, o.offset) + o.replacement + out.slice(o.offset + o.len);
      }

      if (out !== text) {
        await this.app.vault.modify(file, out);
        totalApplied += ops.length;
        filesTouched++;
      }
    }

    new Notice(`已清除 ${totalApplied} 条未解析双链（${filesTouched} 个文件）`);
    this.refreshWli();
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

    // Update zone title with only unresolved count
    const titleEl = this.wliZoneEl.querySelector(".zone-head-title");
    if (titleEl) {
      titleEl.setText(`未解析双链 (${unresolved.length})`);
    }

    if (unresolved.length === 0) {
      this.wliBodyEl.createDiv({
        cls: "wli-empty",
        text: "所有双链均已解析",
      });
      return;
    }

    const shown = unresolved.slice(0, this.limit.unresolved);
    for (const r of shown) {
      renderInspectorRow(this.wliBodyEl, r, (row) => void this.openSource(row));
    }

    if (unresolved.length > this.limit.unresolved) {
      const more = this.wliBodyEl.createDiv({
        cls: "wli-load-more",
        text: `加载更多 +${DEFAULT_PREVIEW}（剩 ${unresolved.length - this.limit.unresolved}）`,
      });
      more.addEventListener("click", () => {
        this.limit.unresolved += DEFAULT_PREVIEW;
        this.renderWliAll();
      });
    }
  }

  // ---- 进程日志 Section ------------------------------------------------------

  private buildProcSection(): void {
    const head = this.procZoneEl.createDiv({ cls: "zone-head" });
    const chevron = head.createDiv({ cls: "zone-head-cv" });
    setIcon(chevron, "chevron-right");
    head.createSpan({ cls: "zone-head-title", text: "终端输出" });
    this.procChevronEl = chevron;

    this.procBodyEl = this.procZoneEl.createDiv({ cls: "zone-proc-body" });

    // collapse whole zone by default
    this.procCollapsed = true;

    head.addEventListener("click", () => {
      this.procCollapsed = !this.procCollapsed;
      setIcon(this.procChevronEl, this.procCollapsed ? "chevron-right" : "chevron-down");
      this.procBodyEl.toggleClass("is-collapsed", this.procCollapsed);
      this.procZoneEl.toggleClass("is-shrunk", this.procCollapsed);
    });
  }

  /** 切换日志区块显示/隐藏 */
  private toggleLogSection(): void {
    this.logSectionVisible = !this.logSectionVisible;
    this.procZoneEl.toggleClass("is-collapsed", !this.logSectionVisible);
    this.logBtnEl.toggleClass("is-active", this.logSectionVisible);
    if (this.logSectionVisible) {
      setIcon(this.logBtnEl, "eye-off");
      // update log-btn text
      const span = this.logBtnEl.querySelector("span");
      if (span) span.setText("隐藏日志");
    } else {
      setIcon(this.logBtnEl, "terminal");
      const span = this.logBtnEl.querySelector("span");
      if (span) span.setText("日志");
    }
    // 展开时同步展开 zone body
    if (this.logSectionVisible && this.procCollapsed) {
      this.procCollapsed = false;
      setIcon(this.procChevronEl, "chevron-down");
      this.procBodyEl.removeClass("is-collapsed");
    }
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
        text: "暂无进程,在设置 > 命令组管理中添加快捷命令",
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

  // ---- 内联表单(编辑进程) -----------------------------------------------

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
