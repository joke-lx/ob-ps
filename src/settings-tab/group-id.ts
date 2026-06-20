/** 持久化数据中命令组的 ID 自增计数器(模块内单例) */
let _groupIdCounter = 0;

/** 分配一个新的命令组 ID */
export function nextGroupId(): string {
  _groupIdCounter += 1;
  return `g-${Date.now().toString(36)}-${_groupIdCounter}`;
}