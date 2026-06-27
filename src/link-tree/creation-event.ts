/**
 * creation-event.ts — 完善捕获事件的不可变事实日志
 *
 * 一条 CreationEvent 记录一次完善点击时捕获到的未解析双链。
 * 这是 Event Sourcing 的「事实」原子：append-only、不可变、不含任何派生状态。
 *
 * @module link-tree/creation-event
 */

/** 不可变捕获事件 —— 存进 PluginData.linkTree.events */
export interface CreationEvent {
  /** 稳定 id（DOM key / 去重） */
  id: string;
  /** 未解析双链的目标笔记名（link 文本，如 "概率论四大公式概念推导"） */
  target: string;
  /** 主源笔记路径（触发捕获的 [[]] 所在文件，如 "概率论/知识点.md"） */
  sourcePath: string;
  /** 该 [[]] 在源笔记中的位置（跳转锚点） */
  position: { line: number; col: number };
  /** 首次在完善点击时捕获的时间戳 */
  firstSeenAt: number;
  /** 哪次完善点击（按批分组 / 筛选用） */
  runId: string;
}

/** 持久化格式：PluginData.linkTree */
export interface LinkTreeStore {
  /** append-only 事件日志 */
  events: CreationEvent[];
  /** schema 版本（迁移用） */
  version: number;
}

/** 默认 schema 版本 */
export const LINK_TREE_VERSION = 1;

// ---- normalize 工具 —— 对齐 sourceBaseName / extractBracketedText ----

/**
 * 规范化 target：剥离 `#anchor`，保留别名前部分。
 * Obsidian metadataCache 的 link.link 不含 |alias（alias 在 displayText），
 * 但可能带 #anchor（如 "概率论四大公式概念推导#公式 3"）→ 剥离。
 */
export function normalizeTarget(target: string): string {
  return target.replace(/#.*/, "").trim();
}

/**
 * 规范化 sourcePath：取最后一段去 `.md` 后缀。
 * 如 "概率论/一维随机变量及其分布.md" → "一维随机变量及其分布"
 */
export function normalizeSourcePath(sourcePath: string): string {
  const basename = sourcePath.split("/").pop() ?? sourcePath;
  return basename.replace(/\.md$/i, "");
}

/**
 * 去重键：按 normalized target 做唯一键。
 * 同一 target 多次捕获只存第一次（后续点击跳过）。
 */
export function dedupKey(event: CreationEvent): string {
  return normalizeTarget(event.target);
}
