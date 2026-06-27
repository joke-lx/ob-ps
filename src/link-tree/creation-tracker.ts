/**
 * creation-tracker.ts — 完善捕获逻辑
 *
 * capture(rows, existingSet, runId) → CreationEvent[]
 * 纯函数：输入当前 vault 的全量连接行 + 已有事件的去重键 + 批次号，
 * 输出本次完善新捕获的事件列表。
 *
 * 由 caller 负责收集 rows（collectRows(makeSource(app))）和去重集。
 */

import type { CreationEvent } from "./creation-event";
import { normalizeTarget, dedupKey } from "./creation-event";

/** LinkRow 的最小形状（wikilink-inspector/link-row 的子集） */
export interface LinkRowLite {
  sourcePath: string;
  sourceCtime: number;
  target: string;
  state: "resolved" | "unresolved";
  position?: { line: number; col: number };
}

/**
 * 从连接行中提取新事件（未解析 + 去重）。
 *
 * @param rows        collectRows() 产出的全量连接行
 * @param existingKeys 已有事件的所有 dedupKey（用于去重）
 * @param runId       本次完善批次的标识符
 * @param firstSeenAt 捕获时间戳
 * @returns 需要 append 的新 CreationEvent[]
 */
export function capture(
  rows: LinkRowLite[],
  existingKeys: Set<string>,
  runId: string,
  firstSeenAt: number,
): CreationEvent[] {
  // 1. 过滤未解析
  const unresolved = rows.filter((r) => r.state === "unresolved");

  // 2. 按 target 聚合选主源（多源取 sourceCtime 最大者）
  const best = new Map<string, LinkRowLite>();
  for (const r of unresolved) {
    const key = normalizeTarget(r.target);
    const prev = best.get(key);
    if (!prev || r.sourceCtime > prev.sourceCtime) {
      best.set(key, r);
    }
  }

  // 3. 去重，构造事件
  const now = firstSeenAt ?? Date.now();
  const events: CreationEvent[] = [];
  for (const [normTarget, row] of best) {
    if (existingKeys.has(normTarget)) continue; // 已捕获过

    events.push({
      id: `${runId}_${normTarget}_${now}`,
      target: row.target,
      sourcePath: row.sourcePath,
      position: row.position ?? { line: 0, col: 0 },
      firstSeenAt: now,
      runId,
    });
  }

  return events;
}

/**
 * 从事件列表建出去重键集合（用于 dedup）。
 */
export function buildDedupSet(events: CreationEvent[]): Set<string> {
  return new Set(events.map(dedupKey));
}

