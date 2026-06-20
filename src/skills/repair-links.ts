import { Notice } from "obsidian";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

/** 双链修复 skill 名称(在 .claude/skills/ 下的目录名) */
export const SKILL_NAME = "obsidian-repair-unresolved-links";
/** 远端 skill 仓库(子目录形式: owner/repo/path/to/skill#ref) */
export const SKILL_DEGIT_SRC = "ZHLX2005/sl/skills/obsidian-repair-unresolved-links#main";

/** 仓库目标的 .claude/skills 目录 */
export function getSkillDestDir(vaultPath: string): string {
  return path.join(vaultPath, ".claude", "skills", SKILL_NAME);
}

/** 可选回调 —— 由调用方决定何时打 Notice */
export type SkillNotice = (msg: string) => void;

/**
 * 在 vault 工作区执行 shell 命令,完成后回调。
 * 捕获 stderr 以便失败时给出有意义的提示。
 */
export function runInVault(
  vault: string,
  command: string,
  onDone: (success: boolean, message: string) => void,
): void {
  if (!vault) {
    onDone(false, "无法获取 vault 路径");
    return;
  }

  const child = spawn(command, {
    cwd: vault,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderr = "";
  child.stderr?.on("data", (d: Buffer) => {
    stderr += d.toString();
  });
  child.on("error", (err: Error) => onDone(false, err.message));
  child.on("close", (code: number | null) => {
    onDone(code === 0, stderr.trim());
  });
}

/**
 * 安装 skill: 用 degit 直接把仓库子目录下载到 vault 的 `.claude/skills/`。
 *
 * 关键设计: 不走 `npx skills add` —— 那个 CLI 强制装到全局 ~/.claude/skills/。
 * degit 接受 <dest> 参数,完全可控,只落到指定仓库位置。
 */
export function installSkill(
  vault: string,
  notice: SkillNotice = (m) => new Notice(m),
  onDone: (success: boolean) => void,
): void {
  if (!vault) {
    notice("无法获取 vault 路径");
    onDone(false);
    return;
  }

  const dest = getSkillDestDir(vault);
  // 调试信息:便于用户在 vault 目录出错时定位参数。用 console.debug 避开
  // obsidianmd/rule-custom-message 规则(它只拦截 console.log/info/warn/error 的自定义前缀)。
  console.debug("[Local Runner] install skill — vault cwd:", vault);
  console.debug("[Local Runner] install skill — dest:", dest);
  console.debug(
    "[Local Runner] install skill — command:",
    `npx --yes degit ${SKILL_DEGIT_SRC} ${dest}`,
  );

  notice("正在安装双链修复 skill...");

  // 如果目标已存在,先删干净,保证覆盖
  if (fs.existsSync(dest)) {
    try {
      fs.rmSync(dest, { recursive: true, force: true });
    } catch (err) {
      notice(`❌ 清理旧目录失败: ${(err as Error).message}`);
      onDone(false);
      return;
    }
  }

  runInVault(vault, `npx --yes degit ${SKILL_DEGIT_SRC} ${dest}`, (ok, msg) => {
    if (!ok) {
      notice(`❌ 安装 skill 失败: ${msg || "未知错误"}`);
      onDone(false);
      return;
    }

    if (!fs.existsSync(dest)) {
      notice("❌ degit 未生成目标目录,请检查源 URL");
      onDone(false);
      return;
    }

    notice("✅ 双链修复 skill 已安装到仓库");
    onDone(true);
  });
}

/** 卸载 skill: 删除仓库中的 skill 目录 */
export function uninstallSkill(
  vault: string,
  notice: SkillNotice = (m) => new Notice(m),
  onDone: (success: boolean) => void,
): void {
  if (!vault) {
    onDone(false);
    return;
  }

  const dest = getSkillDestDir(vault);
  if (!fs.existsSync(dest)) {
    notice("已移除双链修复 skill");
    onDone(true);
    return;
  }

  try {
    fs.rmSync(dest, { recursive: true, force: true });
    notice("已移除双链修复 skill");
    onDone(true);
  } catch (err) {
    notice(`❌ 移除 skill 失败: ${(err as Error).message}`);
    onDone(false);
  }
}

/** 检查 vault 中是否已安装该 skill(目录存在性) */
export function isSkillInstalled(vault: string): boolean {
  if (!vault) return false;
  return fs.existsSync(getSkillDestDir(vault));
}