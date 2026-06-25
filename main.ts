import { FileSystemAdapter, MarkdownView, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import type { ProcessConfig } from "./src/types/process";
import { DEFAULT_SETTINGS, type PluginSettings } from "./src/types/settings";
import { MERGED_VIEW_TYPE, MergedRunnerInspectorView, type MergedViewOptions } from "./src/view";
import {
  REPAIR_UNRESOLVED_LINKS_COMMAND,
  REPAIR_UNRESOLVED_LINKS_TAB_NAME,
  isRunning,
  stopProcess,
} from "./src/runner";
import {
  removeDataBackup,
  restoreDataBackup,
  writeDataBackup,
  type BackupPayload,
} from "./src/backup/data-backup";
import { LocalRunnerSettingTab } from "./src/settings-tab";
import { migrateCommandGroups } from "./src/settings-tab/migrate-command-groups";
import { applyWikilinkStyle } from "./src/wikilink/highlight";
import {
  type RepairTabStatus,
} from "./src/wikilink-inspector";
import { isSkillInstalled } from "./src/skills/repair-links";
import { flattenWikilinks } from "./src/wikilink-inspector/flatten-links";

/** 编程方式跳转到设置标签页(内部 API) */
interface AppWithSetting {
  setting: { open(): Promise<void>; openTabById(id: string): void };
}

/** 持久化插件数据格式 */
interface PluginData {
  processes: ProcessConfig[];
  settings?: PluginSettings;
}

/**
 * Local Runner —— Obsidian 侧边栏插件。
 * 在侧边栏中启动本地 shell 命令(如 `npm run dev`),并按进程分列实时输出。
 *
 * 仅桌面端可用:依赖 Node 的 `child_process`,移动端沙箱不提供该能力。
 *
 * 本文件只承担「插件入口编排」职责:
 *   - onload: 加载数据 + 注册视图/命令/设置页
 *   - 编排: 把分散能力(skills/backup/wikilink/settings-tab)拼接起来
 * 真正的实现已迁移到 src/{skills,backup,wikilink,settings-tab,view,runner}/。
 */
export default class LocalRunnerPlugin extends Plugin {
  /** 已保存的进程配置,view 构造时传入 */
  private savedConfigs: ProcessConfig[] = [];
  /** 设置 */
  settings: PluginSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    // 1. 加载持久化数据
    let data = (await this.loadData()) as PluginData | null;

    // 2. 主数据缺失(卸载/重装后)时,尝试从 vault 级备份恢复
    let restored = false;
    if (data === null) {
      const backup = this.tryRestoreBackup();
      if (backup) {
        data = { processes: backup.processes, settings: backup.settings };
        restored = true;
      }
    }

    this.savedConfigs = data?.processes ?? [];
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);

    // 3. 迁移 commandGroups:旧「一组多预设」→ 新「一组一命令」
    const rawGroups = this.settings.commandGroups;
    const migratedGroups = migrateCommandGroups(rawGroups);
    const migrated = !shallowEqualGroups(rawGroups, migratedGroups);
    this.settings.commandGroups = migratedGroups;
    if (migrated) {
      await this.saveSettings();
    }

    // 4. 恢复成功后立即写回主数据位置,使后续 loadData 命中
    if (restored) {
      await this.saveSettings();
      new Notice("✅ 已从备份恢复进程配置与设置");
    }

    // 5. 纠正「已安装」与磁盘状态不一致
    this.reconcileInstalledFlag();

    // 6. 应用高亮双链样式
    applyWikilinkStyle(this.settings);

    // 7. 注册设置标签页
    this.addSettingTab(new LocalRunnerSettingTab(this.app, this));

    // 8. 注册合并视图
    this.registerView(MERGED_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      const view = new MergedRunnerInspectorView(leaf, this.buildMergedViewOptions());
      view.setTabsFromConfigs(this.savedConfigs);
      return view;
    });

    // 9. 功能区图标:点击打开侧边栏
    this.addRibbonIcon("play", "Local runner", () => {
      void this.activateView();
    });

    // 10. 命令面板入口
    this.addCommand({
      id: "open",
      name: "打开侧边栏",
      callback: () => {
        void this.activateView();
      },
    });
    this.addCommand({
      id: "open-settings",
      name: "打开设置",
      callback: () => {
        void this.openSettings();
      },
    });
    this.addCommand({
      id: "clear-wikilinks",
      name: "将当前笔记的双链转为单链",
      callback: () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
          new Notice("请先打开一篇笔记");
          return;
        }
        const count = flattenWikilinks(view.editor);
        new Notice(`已将 ${count} 条双链转为单链`);
      },
    });
  }

  /** 打开插件设置页 */
  async openSettings(): Promise<void> {
    const app = this.app as unknown as AppWithSetting;
    await app.setting.open();
    app.setting.openTabById(this.manifest.id);
  }

  /** 激活(或首次创建)侧边栏视图并置顶显示 */
  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(MERGED_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: MERGED_VIEW_TYPE, active: true });
    }
    if (leaf) {
      void workspace.revealLeaf(leaf);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ processes: this.savedConfigs, settings: this.settings });
    // 开启保留时同步刷新备份;关闭时清除已有备份
    const vault = this.getDefaultCwd();
    const configDir = this.app.vault.configDir;
    const payload: BackupPayload = {
      processes: this.savedConfigs,
      settings: this.settings,
    };
    if (this.settings.keepDataOnUninstall) {
      writeDataBackup(vault, configDir, payload);
    } else {
      removeDataBackup(vault, configDir);
    }
  }

  /** 取 vault 根目录作为命令的默认工作目录 */
  getDefaultCwd(): string {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
  }

  /**
   * 编排「修复未解析双链」流程:skill 开关自洽 → 拿到 MergedView → 启动进程。
   * running 状态下重启会先 stop 同名 tab 再 start。
   */
  async onRepairUnresolvedLinks(): Promise<void> {
    const vault = this.getDefaultCwd();
    if (!vault) {
      new Notice("无法获取 vault 路径");
      return;
    }

    // 1) 磁盘实际未安装 → 引导去设置页, 不启动
    if (!isSkillInstalled(vault)) {
      new Notice(
        "请先在「设置 → local runner」安装 Obsidian-repair-unresolved-links skill",
      );
      await this.openSettings();
      return;
    }

    // 2) 磁盘已装但开关未开 → 自动开 + 落盘
    if (!this.settings.repairLinksSkillInstalled) {
      this.settings.repairLinksSkillInstalled = true;
      await this.saveSettings();
    }

    // 3) 确保 MergedView 实例就绪
    const view = await this.getOrActivateMergedView();
    if (!view) {
      new Notice("无法获取视图");
      return;
    }

    // 4) running 状态下重启 → 先 stop 同名 tab
    const existing = view.findTabByCommand(REPAIR_UNRESOLVED_LINKS_COMMAND);
    if (existing && isRunning(existing)) {
      stopProcess(existing, () => {});
    }

    // 5) 启动 (复用同名 或 新建)
    view.startOrCreateTab(
      REPAIR_UNRESOLVED_LINKS_TAB_NAME,
      REPAIR_UNRESOLVED_LINKS_COMMAND,
      vault,
    );
  }

  /** 查询修复 tab 当前状态 —— 供视图按钮图标 + 弹窗使用 */
  private getRepairTabStatus(): RepairTabStatus {
    const leaf = this.app.workspace.getLeavesOfType(MERGED_VIEW_TYPE)[0];
    const view = leaf?.view;
    if (!(view instanceof MergedRunnerInspectorView)) {
      return { kind: "not-exists" };
    }
    const tab = view.findTabByCommand(REPAIR_UNRESOLVED_LINKS_COMMAND);
    if (!tab) {
      return { kind: "not-exists" };
    }
    return isRunning(tab) ? { kind: "running" } : { kind: "exited" };
  }

  /** 获取 MergedView 实例 */
  private async getOrActivateMergedView(): Promise<MergedRunnerInspectorView | null> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(MERGED_VIEW_TYPE)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (!rightLeaf) return null;
      await rightLeaf.setViewState({ type: MERGED_VIEW_TYPE, active: true });
      leaf = rightLeaf;
    }
    const view = leaf.view;
    return view instanceof MergedRunnerInspectorView ? view : null;
  }

  /** 根据设置开关添加/移除高亮双链 body class */
  applyWikilinkStyle(): void {
    applyWikilinkStyle(this.settings);
  }

  // ---- 内部辅助 --------------------------------------------------------------

  /** 视图初始化参数 */
  private buildMergedViewOptions(): MergedViewOptions {
    return {
      defaultCwd: this.getDefaultCwd(),
      settings: this.settings,
      onSaveConfigs: (configs) => {
        this.savedConfigs = configs;
        void this.saveSettings();
      },
      onSaveCommandGroups: (groups) => {
        this.settings.commandGroups = groups;
        void this.saveSettings();
      },
      getRepairTabStatus: () => this.getRepairTabStatus(),
      onRepairUnresolvedLinks: () => void this.onRepairUnresolvedLinks(),
    };
  }

  /** 尝试从 vault 级备份恢复 */
  private tryRestoreBackup(): BackupPayload | null {
    return restoreDataBackup(this.getDefaultCwd(), this.app.vault.configDir);
  }

  /** 同步「已安装」与磁盘状态:已安装但目录不存在时自动重置 */
  private reconcileInstalledFlag(): void {
    if (!this.settings.repairLinksSkillInstalled) {
      return;
    }
    const vault = this.getDefaultCwd();
    if (vault && !isSkillInstalled(vault)) {
      this.settings.repairLinksSkillInstalled = false;
      void this.saveSettings();
    }
  }
}

/** 浅比较两组数组的元素是否一致(按当前形状逐字段比较) */
function shallowEqualGroups(
  a: unknown,
  b: import("./src/types/commands").CommandGroup[],
): boolean {
  if (!Array.isArray(a)) return b.length === 0;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as Record<string, unknown>;
    const y = b[i];
    if (x.id !== y.id) return false;
    if (x.name !== y.name) return false;
    if (x.command !== y.command) return false;
    if ((x.cwd ?? "") !== (y.cwd ?? "")) return false;
  }
  return true;
}
