/**
 * 公共聚合导出 —— 保持原有 `./view` 导入路径的兼容性。
 */

export type { ProcessConfig } from "../types/process";
export type { CommandGroup } from "../types/commands";
export {
  DEFAULT_SETTINGS,
  type PluginSettings,
} from "../types/settings";

export { MERGED_VIEW_TYPE, MergedRunnerInspectorView, type MergedViewOptions } from "./merged-view";
export { ConfirmModal } from "./confirm-modal";
export {
  renderProcessForm,
  type FormMode,
  type FormPrefill,
  type FormSubmitResult,
  type ProcessFormContext,
} from "./process-form";
export {
  renderProcessItem,
  updateProcessItemOutput,
  updateProcessItemStatus,
  statusLabel,
  type ProcessItemContext,
  type RenderedProcessItem,
} from "./process-item";
