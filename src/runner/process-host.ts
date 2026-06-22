import { createTab } from "./process-factory";
import type { RunnerTab } from "./process-model";

/** 启动或创建进程标签页的最小能力 —— 由 RunnerView 实现 */
export interface RunnerHost {
  /**
   * 若 command 已存在则复用并启动;否则新建标签页并启动。
   * 不切换视图、不弹出 UI。
   */
  startOrCreateTab(name: string, command: string, cwd: string): RunnerTab;

  /**
   * 按 command 查找已有标签页;不存在返回 null。
   * 供状态查询使用(按钮图标 + 弹窗),不修改任何 tab。
   */
  findTabByCommand(command: string): RunnerTab | null;
}

/** 修复未解析双链进程标签页的显示名称 */
export const REPAIR_UNRESOLVED_LINKS_TAB_NAME = "修复未解析双链";

/** 修复未解析双链进程标签页的 shell 命令 */
export const REPAIR_UNRESOLVED_LINKS_COMMAND =
  'claude --dangerously-skip-permissions -p "/obsidian-repair-unresolved-links"';

/**
 * 在已有 tabs 中查找同名 command;若不存在则创建新 tab。
 * 纯函数 —— 不修改入参数组,便于单测。
 */
export function resolveOrCreateTab(
  tabs: RunnerTab[],
  name: string,
  command: string,
  cwd: string,
): { tab: RunnerTab; created: boolean } {
  const existing = tabs.find((t) => t.command === command);
  if (existing) {
    return { tab: existing, created: false };
  }
  return { tab: createTab(name, command, cwd), created: true };
}
