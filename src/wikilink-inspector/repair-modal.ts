import { Modal } from "obsidian";

/**
 * 修复未解析双链进程的当前状态(从弹窗视角)。
 * - not-exists: 从未启动,或 tab 被用户删了
 * - running:    进程正在运行
 * - exited:     进程已结束(正常退出 / 异常退出 / 手动停止 统一归此态)
 */
export type RepairTabStatus =
  | { kind: "not-exists" }
  | { kind: "running" }
  | { kind: "exited" };

/** Modal 渲染需要的内容(由纯函数决策,便于单测) */
export interface ModalContent {
  title: string;
  description: string;
  primary: { label: string };
  secondary: { label: string } | null;
}

/**
 * 按进程状态返回弹窗的标题 / 说明 / 按钮文案。
 * 纯函数 —— 不触碰 DOM,便于单测覆盖三态分支。
 */
export function pickModalContent(status: RepairTabStatus): ModalContent {
  switch (status.kind) {
    case "not-exists":
      return {
        title: "修复未解析双链",
        description:
          "将扫描仓库内全部未解析双链,由 claude AI 自动补全或创建缺失笔记。",
        primary: { label: "启动" },
        secondary: null,
      };
    case "running":
      return {
        title: "修复未解析双链(运行中)",
        description: "已有进程正在运行。重启将终止当前进程并重新启动。",
        primary: { label: "重启" },
        secondary: { label: "查看输出" },
      };
    case "exited":
      return {
        title: "修复未解析双链(已退出)",
        description: "上次进程已结束。重启将复用同一标签页并重新启动。",
        primary: { label: "重启" },
        secondary: { label: "查看输出" },
      };
  }
}

/** 弹窗回调 —— 由调用方(WLI 视图)注入,决定按钮点击后做什么 */
export interface RepairModalCallbacks {
  /** 主按钮点击:启动或重启进程 */
  onLaunch: () => void;
  /** 次要按钮点击(仅 running/exited):跳到 RunnerView 查看输出 */
  onReveal?: () => void;
}

/**
 * 修复未解析双链的确认弹窗。
 * 根据 tab 状态渲染不同标题/文案/按钮,按钮点击后调对应回调并关闭。
 */
export class WliRepairConfirmModal extends Modal {
  private readonly status: RepairTabStatus;
  private readonly callbacks: RepairModalCallbacks;

  constructor(
    app: import("obsidian").App,
    status: RepairTabStatus,
    callbacks: RepairModalCallbacks,
  ) {
    super(app);
    this.status = status;
    this.callbacks = callbacks;
  }

  onOpen(): void {
    const content = pickModalContent(this.status);

    this.titleEl.setText(content.title);
    this.contentEl.createEl("p", {
      cls: "wli-repair-desc",
      text: content.description,
    });

    const actions = this.contentEl.createDiv({ cls: "wli-repair-actions" });

    // 次要按钮(查看输出) —— 仅 running/exited 显示
    if (content.secondary) {
      const revealBtn = actions.createEl("button", {
        text: content.secondary.label,
      });
      revealBtn.addEventListener("click", () => {
        this.callbacks.onReveal?.();
        this.close();
      });
    }

    // 主按钮(启动 / 重启)
    const primaryBtn = actions.createEl("button", {
      cls: "mod-cta",
      text: content.primary.label,
    });
    primaryBtn.addEventListener("click", () => {
      this.callbacks.onLaunch();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

