import { Notice } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import type { PluginSettings } from "../types/settings";
import type { ProcessConfig } from "../types/process";

/** 数据备份文件名,存放在 vault 的 .obsidian 目录下(卸载插件时不会被清理) */
export const BACKUP_FILE = "local-runner-backup.json";

/** 持久化数据格式 */
export interface BackupPayload {
  processes: ProcessConfig[];
  settings?: PluginSettings;
}

/** 可选 Notice 回调 */
type BackupNotice = (msg: string) => void;

const notice: BackupNotice = (m) => new Notice(m);

/** 数据备份文件绝对路径 */
export function getDataBackupPath(vault: string, configDir: string): string {
  return path.join(vault, configDir, BACKUP_FILE);
}

/**
 * 将当前持久化数据写入 vault 级备份。
 * 注意:出错仅打印 Notice,不抛 —— 备份失败不应阻塞主流程。
 */
export function writeDataBackup(
  vault: string,
  configDir: string,
  data: BackupPayload,
): void {
  if (!vault) {
    return;
  }
  try {
    const backupPath = getDataBackupPath(vault, configDir);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, JSON.stringify(data), "utf8");
  } catch (err) {
    notice(`❌ 写入数据备份失败: ${(err as Error).message}`);
  }
}

/** 删除 vault 级备份(若存在) */
export function removeDataBackup(vault: string, configDir: string): void {
  if (!vault) {
    return;
  }
  const backupPath = getDataBackupPath(vault, configDir);
  try {
    if (fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, { force: true });
    }
  } catch (err) {
    notice(`❌ 清除数据备份失败: ${(err as Error).message}`);
  }
}

/**
 * 从 vault 级备份读取持久化数据,读取后即删除备份(一次性恢复)。
 * 返回 null 表示没有备份或读取失败。
 */
export function restoreDataBackup(
  vault: string,
  configDir: string,
): BackupPayload | null {
  if (!vault) {
    return null;
  }
  const backupPath = getDataBackupPath(vault, configDir);
  if (!fs.existsSync(backupPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(backupPath, "utf8");
    const parsed = JSON.parse(raw) as {
      processes?: ProcessConfig[];
      settings?: PluginSettings;
    };
    // 恢复后删除备份,避免后续卸载时残留
    fs.rmSync(backupPath, { force: true });
    return { processes: parsed.processes ?? [], settings: parsed.settings };
  } catch (err) {
    notice(`❌ 恢复数据备份失败: ${(err as Error).message}`);
    return null;
  }
}