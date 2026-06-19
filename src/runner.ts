import { ChildProcess, spawn } from "child_process";

/**
 * 单个标签页的进程生命周期状态。
 * - running:子进程存活
 * - exited:进程自行结束(已记录退出码)
 * - stopped:用户手动终止
 */
export type RunnerStatus = "running" | "exited" | "stopped";

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
}

/** 输出缓冲上限,防止长时间运行的服务(如 dev server)持续占用内存 */
const MAX_OUTPUT_CHARS = 200_000;

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
  };
}

/** 追加输出到缓冲;超限时从头部裁剪,只保留最近的内容 */
export function appendOutput(tab: RunnerTab, chunk: string): void {
  tab.output += chunk;
  if (tab.output.length > MAX_OUTPUT_CHARS) {
    tab.output = tab.output.slice(tab.output.length - MAX_OUTPUT_CHARS);
  }
}

export function isRunning(tab: RunnerTab): boolean {
  return tab.child !== null && tab.status === "running";
}

/**
 * 启动标签页对应的命令。若已在运行则直接返回(幂等)。
 *
 * 使用 `shell: true`:一是让 Windows 上的 .cmd 垫片(npm/npx)正常解析,
 * 二是允许用户输入任意 shell 命令(管道、参数等)。
 */
export function startProcess(tab: RunnerTab, onChange: () => void): void {
  if (tab.child) {
    return;
  }

  tab.status = "running";
  tab.exitCode = null;

  let child: ChildProcess;
  try {
    child = spawn(tab.command, {
      cwd: tab.cwd,
      shell: true,
      env: { ...process.env },
      windowsHide: true,
    });
  } catch (err) {
    appendOutput(tab, `\n[启动失败] ${(err as Error).message}\n`);
    tab.status = "exited";
    tab.exitCode = -1;
    onChange();
    return;
  }

  tab.child = child;
  appendOutput(tab, `$ ${tab.command}  (cwd: ${tab.cwd})\n`);

  // stdout / stderr 统一写入同一缓冲,简化展示
  child.stdout?.on("data", (data: Buffer) => {
    appendOutput(tab, data.toString());
    onChange();
  });
  child.stderr?.on("data", (data: Buffer) => {
    appendOutput(tab, data.toString());
    onChange();
  });
  child.on("error", (err: Error) => {
    appendOutput(tab, `\n[错误] ${err.message}\n`);
    tab.status = "exited";
    tab.exitCode = -1;
    tab.child = null;
    onChange();
  });
  child.on("close", (code: number | null) => {
    // 避免 stopProcess 已设置 "stopped" 后被 close 覆盖为 "exited"
    if (tab.status !== "stopped") {
      tab.status = "exited";
      tab.exitCode = code;
      tab.child = null;
      appendOutput(tab, `\n[进程退出,代码 ${code}]\n`);
    } else {
      tab.child = null;
    }
    onChange();
  });
}

/**
 * 终止标签页进程。Windows 下通过 taskkill 杀掉整棵进程树——
 * 直接 child.kill() 只会结束 cmd.exe,残留的 dev server 仍占用端口;
 * 其他平台退化为 SIGTERM。
 */
export function stopProcess(tab: RunnerTab, onChange: () => void): void {
  const child = tab.child;
  if (!child) {
    return;
  }

  try {
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
      });
    } else {
      child.kill();
    }
  } catch (err) {
    console.error("[local-runner] stop failed", err);
  }

  tab.status = "stopped";
  tab.child = null;
  appendOutput(tab, "\n[已手动停止]\n");
  onChange();
}
