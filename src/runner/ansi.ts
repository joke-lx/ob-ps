// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;?]*[a-zA-Z]/g;

/** 移除 ANSI 颜色/样式转义码,保留纯文本 */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}
