import type { App } from "obsidian";
import { TFile } from "obsidian";

/**
 * 一条待应用的"双链 → 单链"编辑。
 * 跨度由 (position, end) 位置决定 —— 来自 metadataCache 的 links[i].position。
 * 不再依赖 raw 文本重建,天然容忍 Obsidian 对 [[内部空格]] 的 trim / BOM / CRLF 等。
 */
export interface UnresolvedEdit {
  /** 源文件 vault 相对路径 */
  sourcePath: string;
  /** 起始位置 —— 对应 [[ 的 '[' */
  position: { line: number; col: number };
  /** 结束位置( ]] 关闭后) —— 用于从原文精确切出待替换长度 */
  end: { line: number; col: number };
  /** 替换内容 —— [text] */
  replacement: string;
}

/**
 * 收集器最小接口 —— 走 metadataCache,避免读文件内容。
 */
export interface CollectorSourceLite {
  listMarkdownFiles(): { path: string }[];
  getFileLinks(path: string): Array<{
    link: string;
    position?: { start: { line: number; col: number }; end: { line: number; col: number } };
  }> | null;
  getUnresolvedTargets(path: string): Set<string>;
}

/** 适配器:把 Obsidian App 折叠成上述最小接口 */
export function makeUnresolvedSource(app: App): CollectorSourceLite {
  return {
    listMarkdownFiles() {
      return app.vault.getMarkdownFiles().map((f) => ({ path: f.path }));
    },
    getFileLinks(path) {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return null;
      const cache = app.metadataCache.getFileCache(file);
      if (!cache?.links) return null;
      return cache.links.map((l) => ({
        link: l.link,
        position: l.position
          ? {
              start: { line: l.position.start.line, col: l.position.start.col },
              end: { line: l.position.end.line, col: l.position.end.col },
            }
          : undefined,
      }));
    },
    getUnresolvedTargets(path) {
      const map = app.metadataCache.unresolvedLinks[path] ?? {};
      return new Set(Object.keys(map));
    },
  };
}

/**
 * 从 Obsidian 的 link 字段(去 [[]] 后的内容,可能含 |alias 和 #anchor)
 * 解出"扁平化"后 [text] 里的 text。
 * 与 flatten-links.ts 的语义一致:
 *   - [[a]]     → "a"
 *   - [[a|b]]   → "b"
 *   - [[a#h]]   → "a#h"(保留 anchor,与现有 flatten 行为一致)
 *   - [[a|b#h]] → "b#h"
 */
export function extractBracketedText(linkField: string): string {
  const pipeIdx = linkField.indexOf("|");
  return pipeIdx >= 0 ? linkField.slice(pipeIdx + 1) : linkField;
}

/**
 * 收集 vault 内所有未解析双链的编辑。
 * frontmatter 链接无 position,跳过;空结果返回 []。
 * raw(待替换文本)不用保存,从 (position, end) 差值得出长度。
 */
export function collectUnresolvedEdits(source: CollectorSourceLite): UnresolvedEdit[] {
  const out: UnresolvedEdit[] = [];
  for (const f of source.listMarkdownFiles()) {
    const links = source.getFileLinks(f.path);
    if (!links) continue;
    const unresolved = source.getUnresolvedTargets(f.path);
    for (const l of links) {
      if (!unresolved.has(l.link)) continue;
      if (!l.position) continue; // frontmatter 链接无位置
      out.push({
        sourcePath: f.path,
        position: { line: l.position.start.line, col: l.position.start.col },
        end: { line: l.position.end.line, col: l.position.end.col },
        replacement: "[" + extractBracketedText(l.link) + "]",
      });
    }
  }
  return out;
}

/** 位置 → 字符偏移 */
function posToOffset(text: string, pos: { line: number; col: number }): number {
  const lines = text.split("\n");
  let off = 0;
  for (let i = 0; i < pos.line; i++) off += (lines[i]?.length ?? 0) + 1;
  return off + pos.col;
}

/**
 * 在文本内把每条编辑替换为 replacement。
 * 长度来自 (position, end) 的 offset 差值,不依赖 raw 文本匹配,
 * 天然容忍 Obsidian 对 [[内部空格]] 的 trim、BOM、CRLF 等。
 *
 * 编辑按 offset 降序处理以免位置漂移。
 */
export function applyEditsToString(
  text: string,
  edits: UnresolvedEdit[],
): { result: string; applied: number } {
  if (edits.length === 0) return { result: text, applied: 0 };

  const stringEdits: { offset: number; len: number; replacement: string }[] = [];
  for (const e of edits) {
    const startOff = posToOffset(text, e.position);
    const endOff = posToOffset(text, e.end);
    const len = endOff - startOff;
    if (len <= 0) continue;
    stringEdits.push({ offset: startOff, len, replacement: e.replacement });
  }
  stringEdits.sort((a, b) => b.offset - a.offset);

  let out = text;
  for (const s of stringEdits) {
    out = out.slice(0, s.offset) + s.replacement + out.slice(s.offset + s.len);
  }
  return { result: out, applied: stringEdits.length };
}

/** 按 sourcePath 分组 */
export function groupEditsByPath(
  edits: UnresolvedEdit[],
): Map<string, UnresolvedEdit[]> {
  const m = new Map<string, UnresolvedEdit[]>();
  for (const e of edits) {
    const list = m.get(e.sourcePath) ?? [];
    list.push(e);
    m.set(e.sourcePath, list);
  }
  return m;
}
