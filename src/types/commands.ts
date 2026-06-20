/**
 * 命令组(用户自定义的快捷命令集合)
 * 用于新建进程表单的快捷下拉填充。
 */

/** 单条命令预设 */
export interface CommandPreset {
  name: string;
  command: string;
  cwd: string;
}

/** 命令组:一组相关的命令预设 */
export interface CommandGroup {
  id: string;
  name: string;
  presets: CommandPreset[];
}
