import type { RunnerTab } from "./process-model";

/** 输出缓冲上限,防止长时间运行的服务(如 dev server)持续占用内存 */
export const MAX_OUTPUT_CHARS = 200_000;

/**
 * 追加输出到缓冲;超限时从头部裁剪,只保留最近的内容。
 * 原地修改 tab.output(参考函数式语义仍把它当作「无副作用的数据变更」)。
 */
export function appendOutput(tab: RunnerTab, chunk: string): void {
  tab.output += chunk;
  if (tab.output.length > MAX_OUTPUT_CHARS) {
    tab.output = tab.output.slice(tab.output.length - MAX_OUTPUT_CHARS);
  }
}
