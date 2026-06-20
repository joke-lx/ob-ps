import type { PluginSettings } from "../types/settings";

/** 高亮双链开关对应的 body class 名 */
export const WIKILINK_BODY_CLASS = "ob-ps-hl-wl";

/**
 * 根据设置开关添加/移除高亮双链 body class。
 * 纯函数 —— 接收 settings 与 document,便于测试。
 */
export function applyWikilinkStyle(
  settings: PluginSettings,
  doc: Document,
): void {
  if (settings.highlightWikilinks) {
    doc.body.addClass(WIKILINK_BODY_CLASS);
  } else {
    doc.body.removeClass(WIKILINK_BODY_CLASS);
  }
}