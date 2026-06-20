import { Setting } from "obsidian";
import type { CommandGroup } from "../types/commands";
import { renderGroupEditor } from "./group-editor";
import { nextGroupId } from "./group-id";

/** 设置标签页需要的插件能力最小集 */
export interface CommandGroupsSectionHost {
  settings: { commandGroups: CommandGroup[] };
  saveSettings(): Promise<void>;
  /** 通知宿主重新绘制整个设置页(用于 add / del / move 后) */
  refreshSettings(): void;
}

/** 渲染「命令组管理」区段:标题 + 描述 + 已有组 + 添加按钮 */
export function render(
  containerEl: HTMLElement,
  host: CommandGroupsSectionHost,
): void {
  new Setting(containerEl).setName("命令组管理").setHeading();
  containerEl.createDiv({
    cls: "setting-item-description",
    text: "定义快捷命令组,新建进程时可通过下拉列表快速填充命令",
  });

  const groups = host.settings.commandGroups;
  for (let gi = 0; gi < groups.length; gi++) {
    renderGroupEditor(containerEl, groups, gi, host);
  }

  new Setting(containerEl).addButton((b) =>
    b
      .setButtonText("＋ 添加命令组")
      .setCta()
      .onClick(() => {
        groups.push({ id: nextGroupId(), name: "新命令组", presets: [] });
        void host.saveSettings().then(() => host.refreshSettings());
      }),
  );
}