import { type ChildProcess, spawn } from "child_process";
import { stripAnsi } from "./ansi";
import { isSuccessExit } from "./exit-code";
import { appendOutput } from "./output-buffer";
import type { RunnerTab } from "./process-model";

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
  // 自增世代号,让旧子进程迟到的 close/error 事件无法污染新进程的状态
  tab.generation += 1;
  const myGen = tab.generation;

  let child: ChildProcess;
  try {
    child = spawn(tab.command, {
      cwd: tab.cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      windowsHide: true,
    });
  } catch (err) {
    appendOutput(tab, `\n[启动失败] ${(err as Error).message}\n`);
    tab.status = "exited-err";
    tab.exitCode = -1;
    tab.child = null;
    onChange();
    return;
  }

  tab.child = child;
  appendOutput(tab, `$ ${tab.command}  (cwd: ${tab.cwd})\n`);

  // stdout / stderr 统一写入同一缓冲,简化展示
  child.stdout?.on("data", (data: Buffer) => {
    if (tab.generation !== myGen) return;
    appendOutput(tab, stripAnsi(data.toString()));
    onChange();
  });
  child.stderr?.on("data", (data: Buffer) => {
    if (tab.generation !== myGen) return;
    appendOutput(tab, stripAnsi(data.toString()));
    onChange();
  });
  child.on("error", (err: Error) => {
    if (tab.generation !== myGen) return;
    appendOutput(tab, `\n[错误] ${err.message}\n`);
    tab.status = "exited-err";
    tab.exitCode = -1;
    tab.child = null;
    onChange();
  });
  child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
    // 旧世代的 close 事件一律丢弃(用户已 stop + restart 的场景)
    if (tab.generation !== myGen) {
      tab.child = null;
      return;
    }
    // 避免 stopProcess 已设置 "stopped" 后被 close 覆盖为 exited
    if (tab.status !== "stopped") {
      tab.status = isSuccessExit(code, signal) ? "exited-ok" : "exited-err";
      tab.exitCode = code;
      tab.child = null;
      const reason = signal ? `信号 ${signal}` : `代码 ${code}`;
      appendOutput(tab, `\n[进程退出,${reason}]\n`);
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
