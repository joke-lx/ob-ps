import type { RunnerTab } from "./process-model";

/** 进程标签页 ID 自增计数器(模块内单例) */
let idCounter = 0;

/** 创建一个尚未启动的新标签页 */
export function createTab(name: string, command: string, cwd: string): RunnerTab {
  idCounter += 1;
  return {
    id: `${Date.now().toString(36)}-${idCounter}`,
    name,
    command,
    cwd,
    status: "stopped",
    exitCode: null,
    output: "",
    child: null,
    generation: 0,
  };
}
