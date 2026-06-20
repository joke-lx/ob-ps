import type { CommandGroup } from "./commands";

/**
 * 插件设置(单一来源)
 * main.ts 与 view.ts 都从这里导入,避免重复定义。
 */
export interface PluginSettings {
  /** 是否已将双链修复 skill 安装到仓库 */
  repairLinksSkillInstalled: boolean;
  /** 是否启用高亮双链样式 */
  highlightWikilinks: boolean;
  /** 卸载/删除插件时是否保留持久化数据(进程配置 + 设置) */
  keepDataOnUninstall: boolean;
  /** 用户定义的命令组,用于快捷填充新建表单 */
  commandGroups: CommandGroup[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
  repairLinksSkillInstalled: false,
  highlightWikilinks: false,
  keepDataOnUninstall: false,
  commandGroups: [],
};
