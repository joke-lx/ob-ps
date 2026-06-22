import { ItemView, MarkdownView, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type { App, CachedMetadata } from "obsidian";
import { collectRows, type CollectorSource, type RawLinkEntry } from "./link-collector";
import { partitionByState, type LinkRow } from "./link-row";
import { renderInspectorRow } from "./inspector-render";
import { WikilinkInspectorModal } from "./inspector-modal";
import { flattenWikilinks } from "./flatten-links";
import {
  WliRepairConfirmModal,
  type RepairTabStatus,
} from "./repair-modal";

export const WIKILINK_INSPECTOR_VIEW_TYPE = "wikilink-inspector-view";

const DEFAULT_PREVIEW = 5;
const REFRESH_DEBOUNCE_MS = 400;

/** 按钮状态轮询间隔(ms) —— 反映进程 running/exited 变化 */
const STATUS_POLL_MS = 1000;

/** 三态对应的 lucide 图标名 */
const STATUS_ICON: Record<RepairTabStatus["kind"], string> = {
  "not-exists": "wand-2",
  running: "loader-2",
  exited: "circle-check",
};

/** 视图构造参数:onOpenRunner 由 main.ts 绑定到 activateView() */
export interface InspectorViewOptions {
  onOpenRunner: () => void;
  /** 查询修复 tab 当前状态(供按钮图标与弹窗使用) */
  getRepairTabStatus: () => RepairTabStatus;
  /** 点击"查看输出"时调用:跳到 RunnerView 并定位修复 tab */
  revealRunnerTab: () => void;
  /** 点击"启动"或"重启"时调用;jumpToRunner=true 时启动后跳转 */
  onRepairUnresolvedLinks: (opts: {
    jumpToRunner: boolean;
  }) => void | Promise<void>;
}

/** 把 app.metadataCache 适配成纯收集器需要的 CollectorSource */
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
        entries.push({ link: l.link }); // frontmatter 链接无 position
      }
      return entries;
    },
    unresolvedTargets(path) {
      const map = app.metadataCache.unresolvedLinks[path] ?? {};
      return new Set(Object.keys(map));
    },
  };
}

export class WikilinkInspectorView extends ItemView {
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
  /** 按钮状态轮询 timer(仅 onOpen 期间运行) */
  private statusTimer: number | null = null;
  private readonly opts: InspectorViewOptions;
  private listEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, opts: InspectorViewOptions) {
    super(leaf);
    this.opts = opts;
  }

  getViewType(): string {
    return WIKILINK_INSPECTOR_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "双链检查";
  }
  getIcon(): string {
    return "link";
  }

  async onOpen(): Promise<void> {
    this.buildUi();
    this.refresh();
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => this.scheduleRefresh()),
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.scheduleRefresh()),
    );
    // 启动按钮状态轮询
    this.refreshStatusIcon();
    this.statusTimer = window.setInterval(
      () => this.refreshStatusIcon(),
      STATUS_POLL_MS,
    );
  }

  async onClose(): Promise<void> {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    if (this.statusTimer !== null) {
      window.clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }

  // ---- UI ----

  private buildUi(): void {
    const root = this.contentEl.createDiv({ cls: "wli-view" });

    const header = root.createDiv({ cls: "wli-header" });
    header.createSpan({ cls: "wli-title", text: "双链检查" });

    const right = header.createDiv({ cls: "wli-header-right" });

    const refreshBtn = right.createDiv({ cls: "wli-header-btn", title: "刷新" });
    setIcon(refreshBtn, "refresh-ccw");
    refreshBtn.addEventListener("click", () => this.refresh());

    const allBtn = right.createDiv({ cls: "wli-header-btn", title: "查看全部" });
    setIcon(allBtn, "layout-grid");
    allBtn.addEventListener("click", () => {
      new WikilinkInspectorModal(this.app, this.rows).open();
    });

    const runnerBtn = right.createDiv({ cls: "wli-header-btn", title: "进程管理" });
    setIcon(runnerBtn, "play");
    runnerBtn.addEventListener("click", () => this.opts.onOpenRunner());

    // 顶栏下方：清除双链操作栏
    const actionBar = root.createDiv({ cls: "wli-action-bar" });
    const clearBtn = actionBar.createDiv({ cls: "wli-action-btn", title: "将当前笔记的双链转为单链" });
    setIcon(clearBtn, "unlink");
    clearBtn.createSpan({ text: " 清除双链" });
    clearBtn.addEventListener("click", () => {
      const view = this.getTargetMarkdownView();
      if (!view) {
        new Notice("没有打开的笔记");
        return;
      }
      const count = flattenWikilinks(view.editor);
      new Notice(`已将 ${count} 条双链转为单链`);
    });

    this.listEl = root.createDiv({ cls: "wli-list" });
  }

  // ---- 数据 ----

  private refresh(): void {
    this.rows = collectRows(makeSource(this.app));
    this.renderAll();
  }

  private scheduleRefresh(): void {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  // ---- 渲染 ----

  private renderAll(): void {
    this.listEl.empty();
    const { resolved, unresolved } = partitionByState(this.rows);

    this.renderSection("unresolved", "未解析", unresolved);
    this.renderSection("resolved", "已解析", resolved);
  }

  private renderSection(
    key: "resolved" | "unresolved",
    label: string,
    rows: LinkRow[],
  ): void {
    // 未解析为空：友好提示，不渲染分组
    if (key === "unresolved" && rows.length === 0) {
      const empty = this.listEl.createDiv({ cls: "wli-empty" });
      empty.createSpan({ text: "✓ 暂无未解析双链" });
      return;
    }

    const section = this.listEl.createDiv({
      cls: `wli-section is-${key}` + (this.collapsed[key] ? " is-collapsed" : ""),
    });

    const head = section.createDiv({ cls: "wli-section-head" });
    const chevron = head.createDiv({ cls: "wli-chevron" });
    setIcon(chevron, this.collapsed[key] ? "chevron-right" : "chevron-down");
    head.createDiv({ cls: `wli-dot is-${key}` });
    head.createSpan({ cls: "wli-section-title", text: `${label} (${rows.length})` });

    // 修复未解析双链按钮 —— 仅在 unresolved 分组显示
    if (key === "unresolved") {
      const action = head.createDiv({
        cls: "wli-section-action",
        title: "修复未解析双链",
        attr: { "aria-label": "修复未解析双链" },
      });
      setIcon(action, STATUS_ICON["not-exists"]);
      action.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onRepairBtnClick();
      });
    }

    head.addEventListener("click", () => {
      this.collapsed[key] = !this.collapsed[key];
      this.renderAll();
    });

    const body = section.createDiv({ cls: "wli-section-body" });
    if (this.collapsed[key]) {
      body.classList.add("is-collapsed");
    }

    const shown = rows.slice(0, this.limit[key]);
    for (const r of shown) {
      renderInspectorRow(body, r, (row) => void this.openSource(row));
    }

    // 加载更多
    if (rows.length > this.limit[key]) {
      const more = body.createDiv({
        cls: "wli-load-more",
        text: `加载更多 +${DEFAULT_PREVIEW}（剩 ${rows.length - this.limit[key]}）`,
      });
      more.addEventListener("click", () => {
        this.limit[key] += DEFAULT_PREVIEW;
        this.renderAll();
      });
    }
  }

  /** 刷新未解析 head 上修复按钮的图标与状态 class */
  private refreshStatusIcon(): void {
    const actionEl = this.contentEl.querySelector<HTMLElement>(
      ".wli-section.is-unresolved .wli-section-action",
    );
    if (!actionEl) return;
    const status = this.opts.getRepairTabStatus();
    setIcon(actionEl, STATUS_ICON[status.kind]);
    actionEl.removeClass("is-running", "is-exited");
    if (status.kind === "running") actionEl.addClass("is-running");
    else if (status.kind === "exited") actionEl.addClass("is-exited");
  }

  /** 修复按钮点击 —— 开确认弹窗,按 tab 状态分支 */
  private onRepairBtnClick(): void {
    const status = this.opts.getRepairTabStatus();
    new WliRepairConfirmModal(this.app, status, {
      onLaunch: () => {
        void this.opts.onRepairUnresolvedLinks({ jumpToRunner: false });
      },
      onReveal: () => this.opts.revealRunnerTab(),
    }).open();
  }

  // ---- 定"位居取 MarkdownView（当前激活 → 回退到首个 markdown leaf） ----

  private getTargetMarkdownView(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) return active;
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (leaf.view instanceof MarkdownView) return leaf.view;
    }
    return null;
  }

  // ---- 跳转 ----

  private async openSource(row: LinkRow): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(row.sourcePath);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const view = leaf.view;
    if (row.position && view instanceof MarkdownView) {
      const { line, col } = row.position;
      const editor = view.editor;
      editor.setCursor({ line, ch: col });
      editor.scrollIntoView(
        { from: { line, ch: 0 }, to: { line, ch: 0 } },
        true,
      );
    }
  }
}
