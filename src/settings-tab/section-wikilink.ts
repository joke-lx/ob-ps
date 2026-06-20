import { Setting } from "obsidian";
import type { PluginSettings } from "../types/settings";

/** 设置标签页需要的插件能力最小集 */
export interface WikilinkSectionHost {
  settings: PluginSettings;
  saveSettings(): Promise<void>;
  applyWikilinkStyle(): void;
}

/** 渲染「高亮双链样式」toggle 设置项 */
export function render(containerEl: HTMLElement, host: WikilinkSectionHost): void {
  new Setting(containerEl)
    .setName("高亮双链样式")
    .setDesc(
      createFragment((frag) => {
        frag.appendText("开启后,笔记中的内部双链（");
        frag.createEl("code", { text: "[[" });
        frag.appendText(" 链接");
        frag.createEl("code", { text: "]]" });
        frag.appendText("）将以高亮样式显示,更醒目美观");
      }),
    )
    .addToggle((t) => {
      t.setValue(host.settings.highlightWikilinks).onChange((v) => {
        host.settings.highlightWikilinks = v;
        host.applyWikilinkStyle();
        void host.saveSettings();
      });
    });
}