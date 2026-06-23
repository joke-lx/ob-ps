import type { ChildProcess } from "child_process";

/**
 * 单个标签页的进程生命周期状态。
 * - running:子进程存活
 * - exited-ok:进程自行结束且退出码 0
 * - exited-err:进程自行结束但退出码非 0
 * - stopped:用户手动终止
 */
export type RunnerStatus = "running" | "exited-ok" | "exited-err" | "stopped";

/**
 * 单条命令标签页的数据模型。
 * 视图持有一组 RunnerTab;runner 工具函数负责变更字段,
 * 并通过传入的回调通知视图刷新。
 */
export interface RunnerTab {
  id: string;
  /** 显示名称,在 UI 上展示 */
  name: string;
  /** shell 命令 */
  command: string;
  /** 工作目录 */
  cwd: string;
  status: RunnerStatus;
  exitCode: number | null;
  /** 纯文本输出缓冲;超过 MAX_OUTPUT_CHARS 时从头部裁剪 */
  output: string;
  /** 正在运行的子进程;未运行时为 null */
  child: ChildProcess | null;
  /**
   * 启动世代号 —— 每次 startProcess 自增 1。
   * 闭包捕获时机的 generation,用于丢弃旧子进程的迟到 close/error 事件,
   * 避免在用户「点停-点启」竞态下旧进程污染新进程的状态。
   */
  generation: number;
}

/** 是否正在运行(子进程存在且状态为 running) */
export function isRunning(tab: RunnerTab): boolean {
  return tab.child !== null && tab.status === "running";
}
