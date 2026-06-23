import type { CommandGroup } from "../types/commands";
import { nextGroupId } from "./group-id";

/** 旧形状的预设(运行时检测用,不要在业务代码引用) */
interface LegacyPreset {
  name?: string;
  command?: string;
  cwd?: string;
}

/** 旧形状的组(运行时检测用) */
interface LegacyGroup {
  id?: string;
  name?: string;
  presets?: LegacyPreset[];
}

/** 任意形状的组(运行时分流) */
type AnyGroup = LegacyGroup | Partial<CommandGroup> | Record<string, unknown>;

/** 输入项是否带 presets 数组(旧形状) */
function isLegacy(g: AnyGroup): g is LegacyGroup {
  return Array.isArray((g as LegacyGroup).presets);
}

/**
 * 把任意形状的 commandGroups 输入规范化成扁平 CommandGroup[]。
 *
 * 旧形状(带 presets 数组):每条非空预设 → 一个新组(组名取 preset.name ?? 原 group.name)。
 * 新形状:原样保留,缺失的 cwd 补成 ""。
 *
 * 纯函数:不修改输入,不读写文件,不抛错(无法识别时尽量保留)。
 */
export function migrateCommandGroups(input: unknown): CommandGroup[] {
  if (!Array.isArray(input)) return [];
  const result: CommandGroup[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const g = raw as AnyGroup;
    if (isLegacy(g)) {
      const fallbackName = (g.name ?? "").trim();
      const presets = g.presets ?? [];
      for (const p of presets) {
        const rawName = (p.name ?? "").trim();
        const command = (p.command ?? "").trim();
        if (!rawName && !command) continue; // 全部为空 → 丢弃
        const name = rawName || fallbackName;
        result.push({
          id: nextGroupId(),
          name,
          command,
          cwd: (p.cwd ?? "").trim(),
        });
      }
    } else {
      // 新形状:直接取字段,缺失则空
      const cg = g as Partial<CommandGroup>;
      result.push({
        id: (cg.id ?? nextGroupId()).toString() || nextGroupId(),
        name: (cg.name ?? "").toString(),
        command: (cg.command ?? "").toString(),
        cwd: (cg.cwd ?? "").toString(),
      });
    }
  }
  return result;
}