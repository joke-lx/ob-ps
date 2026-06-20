import type { PluginSettings } from "../types/settings";

/** 高亮双链开关对应的 body class 名 */
export const WIKILINK_BODY_CLASS = "ob-ps-hl-wl";

/**
 * 根据设置开关添加/移除高亮双链 body class。
 * 使用 `activeDocument` 而非 `document` —— popout 窗口下 `document`
 * 指向主窗口,而 Obsidian 推荐访问当前窗口的文档。
 */
export function applyWikilinkStyle(
  settings: PluginSettings,
  doc: Document = activeDocument,
): void {
  if (settings.highlightWikilinks) {
    doc.body.addClass(WIKILINK_BODY_CLASS);
  } else {
    doc.body.removeClass(WIKILINK_BODY_CLASS);
  }
}