import { Setting } from "obsidian";
import type { PluginSettings } from "../types/settings";
import {
  installSkill,
  isSkillInstalled,
  SKILL_NAME,
  uninstallSkill,
} from "../skills/repair-links";

/** 设置标签页需要的插件能力最小集(避免直接依赖 LocalRunnerPlugin 类) */
export interface SkillSectionHost {
  settings: PluginSettings;
  saveSettings(): Promise<void>;
  getDefaultCwd(): string;
  /** 写完设置后由 UI 触发样式刷新,这里不直接耦合 wikilink 模块 */
  applyWikilinkStyle(): void;
}

/** 渲染「双链修复 skill」toggle 设置项 */
export function render(containerEl: HTMLElement, host: SkillSectionHost): void {
  new Setting(containerEl)
    .setName("添加双链修复 skill")
    .setDesc(
      createFragment((frag) => {
        frag.appendText("从远端仓库拉取 ");
        frag.createEl("code", { text: SKILL_NAME });
        frag.appendText(
          " skill,直接安装到当前仓库的 .claude/skills 目录(不会污染全局)",
        );
      }),
    )
    .addToggle((t) => {
      t.setValue(host.settings.repairLinksSkillInstalled).onChange((v) => {
        if (v) {
          installSkill(host.getDefaultCwd(), undefined, (ok) => {
            host.settings.repairLinksSkillInstalled = ok;
            void host.saveSettings();
            t.setValue(ok);
          });
        } else {
          uninstallSkill(host.getDefaultCwd(), undefined, (ok) => {
            // 卸载失败则回退到已安装状态
            host.settings.repairLinksSkillInstalled = !ok;
            void host.saveSettings();
            t.setValue(host.settings.repairLinksSkillInstalled);
          });
        }
      });
    });
}

/** 同步设置与磁盘实际状态(用于 onload 时纠正状态) */
export function reconcileInstalledFlag(
  vault: string,
  settings: PluginSettings,
): boolean {
  if (settings.repairLinksSkillInstalled && !isSkillInstalled(vault)) {
    settings.repairLinksSkillInstalled = false;
    return true;
  }
  return false;
}