import { Modal } from "obsidian";

/** 二次确认弹窗 —— 替代被 ESLint 禁止的原生 confirm() */
export class ConfirmModal extends Modal {
  private readonly message: string;
  private readonly onConfirm: () => void;

  constructor(app: import("obsidian").App, message: string, onConfirm: () => void) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    this.titleEl.setText("确认操作");
    this.contentEl.createEl("p", { cls: "runner-confirm-msg", text: this.message });

    const actions = this.contentEl.createDiv({ cls: "runner-confirm-actions" });
    const cancelBtn = actions.createEl("button", { text: "取消" });
    cancelBtn.addEventListener("click", () => this.close());

    const confirmBtn = actions.createEl("button", { cls: "mod-warning", text: "确认删除" });
    confirmBtn.addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}