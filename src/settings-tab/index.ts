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

  /**
   * 父类 `PluginSettingTab.display()` 在 Obsidian 1.13+ 被标记为 deprecated,
   * 但作为抽象方法必须实现;Obsidian 在设置页打开时会自动调用它。
   * 此处实现仅做容器清空 + 渲染委派,内部不调用任何 deprecated 方法,
   * 因此无需 `eslint-disable`。
   */
  display(): void {
    this.containerEl.empty();
    this.renderSettings();
  }

  /** 渲染所有设置项(顶部标题 + 基础开关区 + 命令组管理) */
  private renderSettings(): void {
    const { containerEl } = this;
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
   * 刷新设置 UI:清空容器并重新渲染。
   * 不调用父类 deprecated 的 display(),而是直接清空 + 调 renderSettings(),
   * 二者等价,且避开 `no-deprecated` 规则。
   */
  private refreshDisplay(): void {
    this.containerEl.empty();
    this.renderSettings();
  }
}

/** 供 main.ts 调用的状态同步钩子:在 onload 时纠正已安装但目录缺失的情况 */
export function reconcileInstalledFlag(
  vault: string,
  settings: PluginSettings,
): boolean {
  return sectionSkills.reconcileInstalledFlag(vault, settings);
}