// 正则表达式字面量无法避免 ESC 控制字符(0x1B);no-control-regex
// 规则的目的是防止不可见字符意外进入业务逻辑,而 ANSI 序列本身
// 就是要被匹配的字符集,故此处显式禁用。
// eslint-disable-next-line no-control-regex -- ANSI CSI sequences (ESC + '[' + params + final byte) need literal control bytes to match
const ANSI_RE = /\x1B\[[0-9;?]*[a-zA-Z]/g;

/** 移除 ANSI 颜色/样式转义码,保留纯文本 */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}
