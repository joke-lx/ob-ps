/**
 * 命令组(用户自定义的快捷命令)
 * 控制侧边栏快捷启动按钮的集合。
 *
 * 重构 2026-06-23:扁平化,组本身即一条命令,取消原先的 presets 数组。
 */
export interface CommandGroup {
  id: string;
  name: string;     // = 命令显示名
  command: string;  // 单条命令
  cwd: string;      // 工作目录(空表示用默认)
  /** 是否在侧边栏显示(默认 true) */
  visible?: boolean;
}