import { setIcon } from "obsidian";
import type { RunnerTab } from "../runner";

/**
 * 单卡片渲染上下文 —— 主类传给纯渲染函数的必要信息。
 */
export interface ProcessItemContext {
  /** 该标签页是否处于展开状态 */
  expanded: boolean;
  /** 卡片点击(切换启动/停止)的回调 */
  onCardClick: (tab: RunnerTab) => void;
  /** 点击展开箭头的回调 */
  onToggleExpand: (id: string) => void;
  /** 点击编辑按钮的回调 */
  onEdit: (tab: RunnerTab) => void;
  /** 点击删除按钮的回调 */
  onDelete: (id: string) => void;
}

/** 状态指示灯/卡片对应的中文标签 */
export function statusLabel(tab: RunnerTab): string {
  if (tab.status === "running") return "运行中";
  if (tab.status === "stopped") return "已停止";
  if (tab.status === "exited-ok") return "已退出 (0)";
  return `异常退出 (${tab.exitCode ?? "?"})`;
}

/**
 * 渲染单个进程卡片(包含展开的输出区)。
 * 返回包含 item / outputEl 的对象,供后续轻量更新使用。
 */
export interface RenderedProcessItem {
  item: HTMLElement;
  outputEl: HTMLElement;
}

export function renderProcessItem(
  parent: HTMLElement,
  tab: RunnerTab,
  ctx: ProcessItemContext,
): RenderedProcessItem {
  const item = parent.createDiv({ cls: "runner-item" });
  if (ctx.expanded) item.addClass("is-expanded");
  item.setAttr("data-id", tab.id);

  // ---- 按钮卡片:点击整张卡片切换启动/停止 ----
  const card = item.createDiv({ cls: `runner-btn-card is-${tab.status}` });
  card.setAttr("draggable", "true");
  card.addEventListener("click", () => ctx.onCardClick(tab));

  // 拖拽手柄(左侧 grip 图标)
  const dragHandle = card.createDiv({ cls: "runner-drag-handle" });
  setIcon(dragHandle, "grip-vertical");
  dragHandle.addEventListener("click", (e) => e.stopPropagation());

  // 左:指示灯 + 自定义名称(主标签)
  const left = card.createDiv({ cls: "runner-card-left" });
  left.createDiv({ cls: `runner-dot is-${tab.status}` });
  const nameEl = left.createSpan({ cls: "runner-name", text: tab.name });
  nameEl.setAttr("title", `${tab.command}\n${tab.cwd}`);

  // 右:展开箭头 + 编辑 + 删除
  const right = card.createDiv({ cls: "runner-card-right" });

  // 展开/收起
  const expandIcon = right.createDiv({ cls: "runner-expand" });
  setIcon(expandIcon, ctx.expanded ? "chevron-up" : "chevron-down");
  expandIcon.addEventListener("click", (e) => {
    e.stopPropagation();
    ctx.onToggleExpand(tab.id);
  });

  // 编辑
  const editBtn = right.createDiv({ cls: "runner-card-btn is-edit" });
  setIcon(editBtn, "pencil");
  editBtn.setAttr("title", "编辑");
  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    ctx.onEdit(tab);
  });

  // 删除
  const delBtn = right.createDiv({ cls: "runner-card-btn is-delete" });
  delBtn.setText("×");
  delBtn.setAttr("title", "删除进程");
  delBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    ctx.onDelete(tab.id);
  });

  // ---- 卡片底部:状态文字 ----
  const meta = item.createDiv({ cls: "runner-card-meta" });
  meta.createSpan({ cls: `runner-status-text is-${tab.status}`, text: statusLabel(tab) });

  // ---- 可展开的输出区 ----
  const body = item.createDiv({ cls: "runner-body" });
  body.style.display = ctx.expanded ? "" : "none";

  const outputEl = body.createEl("pre", { cls: "runner-output" });
  outputEl.setText(tab.output || "（无输出）");

  return { item, outputEl };
}

/**
 * 轻量更新某个项目的状态指示器(圆点颜色 / 状态文字 / 卡片视觉状态)。
 * 不重建 DOM,只修改类名和文本。
 */
export function updateProcessItemStatus(item: HTMLElement, tab: RunnerTab): void {
  // 卡片边框/背景
  const card = item.querySelector(".runner-btn-card");
  if (card) {
    card.removeClass("is-running", "is-exited-ok", "is-exited-err", "is-stopped");
    card.addClass(`is-${tab.status}`);
  }

  // 指示灯
  const dot = item.querySelector(".runner-dot");
  if (dot) {
    dot.removeClass("is-running", "is-exited-ok", "is-exited-err", "is-stopped");
    dot.addClass(`is-${tab.status}`);
  }

  // 状态文字
  const st = item.querySelector(".runner-status-text");
  if (st) {
    st.setText(statusLabel(tab));
    st.removeClass("is-running", "is-exited-ok", "is-exited-err", "is-stopped");
    st.addClass(`is-${tab.status}`);
  }
}

/**
 * 更新单个展开项的输出文本(含自动滚动)。
 * nearBottom 时维持贴底;forceScroll=true 时强制滚到底(用于刚展开时)。
 */
export function updateProcessItemOutput(
  outputEl: HTMLElement,
  tab: RunnerTab,
  forceScroll: boolean,
): void {
  const nearBottom =
    outputEl.scrollHeight - outputEl.scrollTop - outputEl.clientHeight < 30;
  outputEl.setText(tab.output || "（无输出）");
  if (forceScroll || nearBottom) {
    outputEl.scrollTop = outputEl.scrollHeight;
  }
}