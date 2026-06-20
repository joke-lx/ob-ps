/**
 * 进程退出码的语义判断
 * - 0 视为成功
 * - null(信号量异常退出)或非 0 视为失败
 */
export function isSuccessExit(code: number | null, _signal: NodeJS.Signals | null): boolean {
  if (code === 0) return true;
  return false;
}
