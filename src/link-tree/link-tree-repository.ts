/**
 * link-tree-repository.ts — PluginData.linkTree 的读写（Repository 模式）
 *
 * 封装 load/append，隔离 PluginData 细节。上层只调：
 *   repo.loadEvents(pluginData) → CreationEvent[]
 *   repo.buildStore(existing + new) → LinkTreeStore  ← 给 main.saveData 用
 */

import type { CreationEvent, LinkTreeStore } from "./creation-event";
import { LINK_TREE_VERSION } from "./creation-event";

/** Obsidian PluginData 的最小形状（本仓库只关心 linkTree） */
export interface HasLinkTree {
  linkTree?: LinkTreeStore;
}

/**
 * 从 PluginData 中提取已有事件列。
 * 字段缺失 / 版本不匹配时返回 []（安全初始化）。
 */
export function loadEvents(data: HasLinkTree | null): CreationEvent[] {
  if (!data?.linkTree?.events) return [];
  return data.linkTree.events;
}

/**
 * 追加新事件并返回新的 store。
 * 不修改入参（不可变追加）。
 *
 * @param existing 已有事件
 * @param newEvents 新捕获事件
 * @returns 全新 LinkTreeStore（可写入 PluginData.linkTree）
 */
export function appendEvents(
  existing: CreationEvent[],
  newEvents: CreationEvent[],
): LinkTreeStore {
  return {
    events: [...existing, ...newEvents],
    version: LINK_TREE_VERSION,
  };
}

/**
 * 从零创建初始 store（无事件时初始化用）。
 */
export function createEmptyStore(): LinkTreeStore {
  return { events: [], version: LINK_TREE_VERSION };
}
