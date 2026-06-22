import type { PluginSettings } from "../types/settings";

/** 高亮双链开关对应的 body class 名 */
export const WIKILINK_BODY_CLASS = "ob-ps-hl-wl";

/** 运行时注入的 style 元素 id(用于覆盖 CM6 未闭合双链颜色) */
const INLINE_STYLE_ID = "ob-ps-hl-wl-inline";

/**
 * 根据设置开关添加/移除高亮双链 body class,
 * 并同步注入/移除运行时 CSS(覆盖 CM6 未闭合 [[ 的颜色)。
 * 使用 `activeDocument` 而非 `document` —— popout 窗口下 `document`
 * 指向主窗口,而 Obsidian 推荐访问当前窗口的文档。
 */
export function applyWikilinkStyle(
  settings: PluginSettings,
  doc: Document = activeDocument,
): void {
  if (settings.highlightWikilinks) {
    doc.body.addClass(WIKILINK_BODY_CLASS);
    injectInlineStyles(doc);
  } else {
    doc.body.removeClass(WIKILINK_BODY_CLASS);
    removeInlineStyles(doc);
  }
}

/** 注入运行时样式(在 <head> 末尾,确保超越所有 stylesheet) */
function injectInlineStyles(doc: Document): void {
  if (doc.getElementById(INLINE_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = INLINE_STYLE_ID;
  style.textContent = [
    /* 未闭合 [[:只命中双链上下文内的 barelink */
    `body.ob-ps-hl-wl .cm-hmd-barelink.cm-link {`,
    `  color: var(--ob-wl-unresolved-fg) !important;`,
    `}`,
    /* 暗色主题 */
    `body.ob-ps-hl-wl.theme-dark .cm-hmd-barelink.cm-link {`,
    `  color: var(--ob-wl-unresolved-fg) !important;`,
    `}`,
    /* 阅读视图的外链兼容(防外部链接泄露) */
    `body.ob-ps-hl-wl .cm-s-obsidian .cm-hmd-barelink.cm-link {`,
    `  color: var(--ob-wl-unresolved-fg) !important;`,
    `}`,
  ].join("\n");
  doc.head.appendChild(style);
}

/** 移除运行时样式 */
function removeInlineStyles(doc: Document): void {
  const el = doc.getElementById(INLINE_STYLE_ID);
  if (el) el.remove();
}