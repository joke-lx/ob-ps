/**
 * 公共聚合导出 —— 保持原有 `./runner` 导入路径的兼容性。
 */

export type { RunnerStatus, RunnerTab } from "./process-model";
export { isRunning } from "./process-model";
export { createTab } from "./process-factory";
export type { RunnerHost } from "./process-host";
export {
  REPAIR_UNRESOLVED_LINKS_TAB_NAME,
  REPAIR_UNRESOLVED_LINKS_COMMAND,
  resolveOrCreateTab,
} from "./process-host";
export { appendOutput, MAX_OUTPUT_CHARS } from "./output-buffer";
export { stripAnsi } from "./ansi";
export { isSuccessExit } from "./exit-code";
export { startProcess, stopProcess } from "./process-lifecycle";
