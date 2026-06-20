import { Notice, Setting } from "obsidian";
import type { PluginSettings } from "../types/settings";

/** 设置标签页需要的插件能力最小集 */
export interface KeepDataSectionHost {
  settings: PluginSettings;
  saveSettings(): Promise<void>;
}

/** 渲染「卸载插件时保留数据」toggle 设置项 */
export function render(
  containerEl: HTMLElement,
  host: KeepDataSectionHost,
): void {
  new Setting(containerEl)
    .setName("卸载插件时保留数据")
    .setDesc(
      createFragment((frag) => {
        frag.appendText(
          "开启后,进程配置与设置会额外备份到 vault 中(独立于插件目录,卸载不会被清理);重新安装插件时自动恢复。关闭此开关会清除已有备份。",
        );
      }),
    )
    .addToggle((t) => {
      t.setValue(host.settings.keepDataOnUninstall).onChange((v) => {
        host.settings.keepDataOnUninstall = v;
        void host.saveSettings().then(() => {
          new Notice(v ? "✅ 已开启:卸载时保留数据" : "已关闭,并清除备份");
        });
      });
    });
}