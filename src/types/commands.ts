/**
 * 命令组(用户自定义的快捷命令)
 * 用于新建进程表单的快捷下拉填充。
 *
 * 重构 2026-06-23:扁平化,组本身即一条命令,取消原先的 presets 数组。
 */
export interface CommandGroup {
  id: string;
  name: string;     // = 命令显示名
  command: string;  // 单条命令
  cwd: string;      // 工作目录(空表示用默认)
}