/**
 * link-tree-view.ts — 完善历史树视图桥接
 *
 * 在 merged-view 中挂载的 UI 控制器：创建 canvas、管理全链路更新、
 * 处理作用域过滤、编排折叠状态与 expanded modal 模式。
 *
 * 使用方式（在 merged-view.ts 中）:
 *   private treeView = new TreeLinkView(this.app, callbacks);
 *   buildWliSection() 里: treeView.mount(wliZoneEl);
 *   refreshWli() 末尾:  treeView.update(events, deps);
 */

import { LinkTreeCanvas } from "./link-tree-canvas";
import type { CreationEvent } from "./creation-event";
import { normalizeTarget } from "./creation-event";
import { makeProjectDeps, type ProjectDeps } from "./tree-projector";
import { loadEvents, appendEvents, type HasLinkTree } from "./link-tree-repository";
import type { App } from "obsidian";

/** 顶层文件夹路径第一段（用于作用域过滤） */
function firstSeg(path: string): string {
  const idx = path.indexOf("/");
  return idx < 0 ? "(root)" : path.slice(0, idx);
}

/**
 * 按当前笔记路径过滤事件到同一顶层文件夹。
 * 活跃笔记不存在则退化为全部。
 */
export function filterByActiveNote(
  events: CreationEvent[],
  activeNotePath: string | null,
): CreationEvent[] {
  if (!activeNotePath) return events;
  const zone = firstSeg(activeNotePath);
  return events.filter((e) => firstSeg(e.sourcePath) === zone);
}

// ---- 视图类 ----

export class TreeLinkView {
  private canvas: LinkTreeCanvas;
  private container: HTMLElement | null = null;
  private collapsed: Set<string> = new Set();
  private currentEvents: CreationEvent[] = [];
  private currentDeps: ProjectDeps | null = null;
  private currentActiveNotePath: string | null = null;
  private onJump: ((event: CreationEvent) => void) | null = null;

  /** 注入 openSource 回调（由 merged-view 提供） */
  constructor(onJump: (event: CreationEvent) => void) {
    this.canvas = new LinkTreeCanvas();
    this.onJump = onJump;
  }

  /** 挂载 canvas 到某个 HTMLElement（如双链检查 zone） */
  mount(container: HTMLElement): void {
    this.container = container;
    this.canvas.mount(container, {
      onJump: (ev) => this.onJump?.(ev),
      onCollapseChange: (s) => {
        this.collapsed = s;
        if (this.currentDeps) {
          this.canvas.setCollapsed(this.collapsed);
          const filtered = this.currentActiveNotePath
            ? filterByActiveNote(this.currentEvents, this.currentActiveNotePath)
            : this.currentEvents;
          this.canvas.update(filtered, this.currentDeps);
        }
      },
    });
  }

  /** 全链路更新（过滤 → 投影 → 布局 → 绘制） */
  update(
    events: CreationEvent[],
    deps: ProjectDeps,
    activeNotePath?: string | null,
  ): void {
    this.currentEvents = events;
    this.currentDeps = deps;
    this.currentActiveNotePath = activeNotePath ?? null;
    console.log("[link-tree] update", { raw: events.length, activeNotePath });

    const filtered = activeNotePath
      ? filterByActiveNote(events, activeNotePath)
      : events;
    console.log("[link-tree] filtered events:", filtered.length);

    const noteBasename = activeNotePath
      ? (activeNotePath.split("/").pop() ?? "").replace(/\.md$/i, "")
      : "";
    const activeNoteTarget = noteBasename
      ? filtered.find((e) => normalizeTarget(e.target) === noteBasename)?.target ?? null
      : null;

    this.canvas.setCollapsed(this.collapsed);
    this.canvas.update(filtered, deps, activeNoteTarget);
  }

  /** 便捷版本：从 app 构建 deps */
  updateFromApp(
    events: CreationEvent[],
    app: App,
    activeNotePath?: string | null,
  ): void {
    this.update(events, makeProjectDeps(app), activeNotePath);
  }

  /** 重置折叠状态并重算 */
  collapseAll(): void {
    this.collapsed = new Set(
      this.currentEvents.map((e) => e.target),
    );
    if (this.currentEvents.length && this.currentDeps) {
      this.canvas.setCollapsed(this.collapsed);
      this.canvas.update(
        filterByActiveNote(this.currentEvents, null),
        this.currentDeps,
      );
    }
  }

  expandAll(): void {
    this.collapsed.clear();
    if (this.currentDeps) {
      this.canvas.setCollapsed(this.collapsed);
      this.canvas.update(
        filterByActiveNote(this.currentEvents, null),
        this.currentDeps,
      );
    }
  }

  /** 切换到全屏 Modal 模式（复用现有 Modal 壳） */
  // （待实现——复用 WikilinkInspectorModal 模式）

  destroy(): void {
    this.canvas.destroy();
    this.container = null;
  }
}

// ---- 仓库便捷函数 ----

export { loadEvents, appendEvents };
export type { HasLinkTree };
