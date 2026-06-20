import { Plugin, PluginSettingTab, Setting } from "obsidian";
import type { PluginSettings } from "../types/settings";
import * as sectionSkills from "./section-skills";
import * as sectionWikilink from "./section-wikilink";
import * as sectionKeepData from "./section-keep-data";
import * as sectionCommandGroups from "./section-command-groups";
import type { CommandGroup } from "../types/commands";

/**
 * 设置标签页需要的宿主能力最小集。
 *
 * 实际实现就是 `LocalRunnerPlugin` 本身 —— 它已经把 settings / saveSettings
 * / getDefaultCwd / applyWikilinkStyle 暴露为公开成员。
 *
 * 为什么不让 `LocalRunnerSettingTab` 接受一个 plain object 假装是 Plugin?
 * Obsidian 1.13+ 的 `PluginSettingTab.getControlValue` 默认实现会读
 * `this.plugin.settings`,父类在 `SettingTab` 注册时也会读 `plugin.manifest.id`。
 * 如果传非 `Plugin` 实例,运行时立刻报 "Cannot read properties of undefined"。
 * 因此本类坚持接收真实 `Plugin` 实例,再用 `as unknown as SettingTabHost` 转换。
 */
export interface SettingTabHost {
  settings: PluginSettings;
  saveSettings(): Promise<void>;
  getDefaultCwd(): string;
  applyWikilinkStyle(): void;
}

/**
 * Local Runner 设置标签页 —— 各 section 模块的组合根。
 * 顺序拼装,保证设置项相对位置与原行为一致。
 */
export class LocalRunnerSettingTab extends PluginSettingTab {
  constructor(app: import("obsidian").App, plugin: Plugin & SettingTabHost) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // PluginSettingTab 在 .d.ts 里未公开 plugin 字段;运行时父类构造时已存入
    const host = (this as unknown as { plugin: SettingTabHost }).plugin;

    // 顶部标题
    new Setting(containerEl).setName("设置").setHeading();

    // 基础开关区
    sectionSkills.render(containerEl, {
      settings: host.settings,
      saveSettings: () => host.saveSettings(),
      getDefaultCwd: () => host.getDefaultCwd(),
      applyWikilinkStyle: () => host.applyWikilinkStyle(),
    });
    sectionWikilink.render(containerEl, {
      settings: host.settings,
      saveSettings: () => host.saveSettings(),
      applyWikilinkStyle: () => host.applyWikilinkStyle(),
    });
    sectionKeepData.render(containerEl, {
      settings: host.settings,
      saveSettings: () => host.saveSettings(),
    });

    // 底部:命令组管理
    const groups: CommandGroup[] = host.settings.commandGroups;
    sectionCommandGroups.render(containerEl, {
      settings: { commandGroups: groups },
      saveSettings: () => host.saveSettings(),
      refreshSettings: () => this.refreshDisplay(),
    });
  }

  /**
   * 刷新设置 UI。
   * 父类 `PluginSettingTab.display()` 虽在 1.13+ 标记为 deprecated,
   * 但新接口 `getSettingDefinitions()` 需要将所有设置项重写为声明式结构,
   * 工作量超出本次重构范围;此处沿用旧 API 以保持行为不变。
   */
  private refreshDisplay(): void {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- 父类抽象方法,无替代
    this.display();
  }
}

/** 供 main.ts 调用的状态同步钩子:在 onload 时纠正已安装但目录缺失的情况 */
export function reconcileInstalledFlag(
  vault: string,
  settings: PluginSettings,
): boolean {
  return sectionSkills.reconcileInstalledFlag(vault, settings);
}