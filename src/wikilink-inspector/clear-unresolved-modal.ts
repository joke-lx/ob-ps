import { Modal } from "obsidian";

/** 确认弹窗要渲染的内容(由纯函数决策,便于单测) */
export interface ClearUnresolvedContent {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
}

/**
 * 按未解析条数返回弹窗文案。
 * 纯函数 —— 不触碰 DOM。
 */
export function pickClearUnresolvedContent(
  count: number,
): ClearUnresolvedContent {
  return {
    title: "清除未解析双链",
    description:
      `范围:未解析 (${count} 条)\n` +
      `将把这 ${count} 条 [[未解析双链]] 转为 [单链],该操作不可撤销。`,
    confirmLabel: `确认清除 ${count} 处`,
    cancelLabel: "取消",
  };
}

/** 弹窗回调 —— 由调用方(view)注入 */
export interface ClearUnresolvedCallbacks {
  onConfirm: () => void | Promise<void>;
}

/**
 * 清除未解析双链的二次确认弹窗。
 * 纯渲染壳:文案来自 pickClearUnresolvedContent,确认后调 onConfirm 并关闭。
 */
export class ClearUnresolvedConfirmModal extends Modal {
  private readonly count: number;
  private readonly callbacks: ClearUnresolvedCallbacks;

  constructor(
    app: import("obsidian").App,
    count: number,
    callbacks: ClearUnresolvedCallbacks,
  ) {
    super(app);
    this.count = count;
    this.callbacks = callbacks;
  }

  onOpen(): void {
    const content = pickClearUnresolvedContent(this.count);

    this.titleEl.setText(content.title);
    this.contentEl.createEl("p", {
      cls: "wli-clear-desc",
      text: content.description,
    });

    const actions = this.contentEl.createDiv({ cls: "wli-clear-actions" });
    const cancelBtn = actions.createEl("button", { text: content.cancelLabel });
    cancelBtn.addEventListener("click", () => this.close());

    const confirmBtn = actions.createEl("button", {
      cls: "mod-warning",
      text: content.confirmLabel,
    });
    confirmBtn.addEventListener("click", () => {
      void this.callbacks.onConfirm();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
