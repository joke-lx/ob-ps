/**
 * tree-projector.ts — 事件日志 → 树（O(E) 投影）
 *
 * projectTree(events, deps) → TreeNode[]
 *
 * 用 Event Sourcing 的「派生投影」模式：
 *   - parent/children 靠事件自身的 target↔basename 匹配，O(E)，不碰 rows
 *   - status/isStale 靠 Obsidian 的 O(1) 查询（注入 ProjectDeps）
 *   - refs 踢出热路径，延迟到按需计算
 *
 * 纯函数，注入依赖可测。
 */

import type { CreationEvent } from "./creation-event";
import { normalizeTarget, normalizeSourcePath } from "./creation-event";
import type { TFile, TAbstractFile } from "obsidian";

// ---- 投影模型（不存储）----

export interface TreeNode {
  /** 对应的事件（附录——本节点来自哪次捕获） */
  event: CreationEvent;
  /** 子节点（派生：事件自身 target↔basename 匹配，不查 rows） */
  children: TreeNode[];
  /** 状态（派生：Obsidian O(1) 查询） */
  status: "created" | "pending";
  /** 源笔记是否被删（派生：Obsidian O(1) 查询） */
  isStale: boolean;
  /** 深度（派生：递归层数） */
  depth: number;
}

// ---- 注入的 Obsidian 查询依赖 ----

export interface ProjectDeps {
  /** target 对应的文件在 vault 中是否存在 */
  isResolved: (target: string, sourcePath: string) => boolean;
  /** sourcePath 对应的文件在 vault 中是否存在 */
  sourceExists: (sourcePath: string) => boolean;
}

// ---- 投影函数 O(E) ----

/**
 * 事件日志 → 树。
 * 复杂度 O(E)，与 vault 链接总数 R 无关。
 * parent/children 靠事件自身匹配，status/isStale 靠 ProjectDeps 的 O(1) 查询。
 *
 * @returns 根节点数组（roots），每个 root 递归含 children
 */
export function projectTree(
  events: CreationEvent[],
  deps: ProjectDeps,
): TreeNode[] {
  // 0. 事件索引 byNormalizedTarget：同 target 多事件取最新
  const byTarget = new Map<string, CreationEvent>();
  for (const e of events) {
    const key = normalizeTarget(e.target);
    const prev = byTarget.get(key);
    if (!prev || e.firstSeenAt < prev.firstSeenAt) {
      byTarget.set(key, e);
    }
  }

  // 1. 分类 → 逐个创建 TreeNode（按 firstSeenAt 升序处理，
  //    parent 仅在 nodeMap 中已存在时才挂载 → 自然打破循环）
  const sorted = [...events].sort((a, b) => a.firstSeenAt - b.firstSeenAt);
  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const e of sorted) {
    const node: TreeNode = {
      event: e,
      children: [],
      status: "pending",
      isStale: false,
      depth: 0,
    };
    nodeMap.set(e.id, node);

    const parentKey = normalizeSourcePath(e.sourcePath);
    const parentEvent = byTarget.get(parentKey);

    if (parentEvent && parentEvent.id !== e.id) {
      // 只在父节点已进入 nodeMap（已在更早 firstSeenAt 被处理过）时才挂载
      const parentNode = nodeMap.get(parentEvent.id);
      if (parentNode) {
        parentNode.children.push(node);
        continue;
      }
    }
    // 根节点（触发源不在事件日志里，或触发自身，或循环引用打破后）
    roots.push(node);
  }

  // 3. 修饰每个 node——status/isStale（O(1) 查询）、depth（递归）
  function annotate(node: TreeNode, depth: number): void {
    node.depth = depth;
    node.status = deps.isResolved(node.event.target, node.event.sourcePath)
      ? "created"
      : "pending";
    node.isStale = !deps.sourceExists(node.event.sourcePath);
    for (const child of node.children) {
      annotate(child, depth + 1);
    }
  }
  for (const root of roots) {
    annotate(root, 0);
  }

  return roots;
}

// ---- Obsidian 适配器 ----

/**
 * 把 Obsidian App 折叠成 ProjectDeps。
 * 使用时传入 `makeProjectDeps(app)`。
 *
 * 与 `makeUnresolvedSource(app)` 同款注入模式，保持可测。
 */
export function makeProjectDeps(app: {
  metadataCache: {
    getFirstLinkpathDest(link: string, source: string): TFile | null;
  };
  vault: {
    getAbstractFileByPath(path: string): TAbstractFile | null;
  };
}): ProjectDeps {
  return {
    isResolved(target, sourcePath) {
      return !!app.metadataCache.getFirstLinkpathDest(target, sourcePath);
    },
    sourceExists(sourcePath) {
      return !!app.vault.getAbstractFileByPath(sourcePath);
    },
  };
}
