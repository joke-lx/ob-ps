/**
 * 进程配置(持久化模型)
 * 不含运行时状态,仅描述用户保存的「想跑什么」。
 */

export interface ProcessConfig {
  id: string;
  /** 显示名称 */
  name: string;
  /** shell 命令 */
  command: string;
  /** 工作目录 */
  cwd: string;
}
