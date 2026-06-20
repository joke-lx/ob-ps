import { FileSystemAdapter, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import type { ProcessConfig } from "./src/types/process";
import { DEFAULT_SETTINGS, type PluginSettings } from "./src/types/settings";
import { RUNNER_VIEW_TYPE, RunnerView, type ViewOptions } from "./src/view";
import {
  removeDataBackup,
  restoreDataBackup,
  writeDataBackup,
  type BackupPayload,
} from "./src/backup/data-backup";
import { LocalRunnerSettingTab } from "./src/settings-tab";
import { applyWikilinkStyle } from "./src/wikilink/highlight";
import { isSkillInstalled } from "./src/skills/repair-links";

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

    // 3. 恢复成功后立即写回主数据位置,使后续 loadData 命中
    if (restored) {
      await this.saveSettings();
      new Notice("✅ 已从备份恢复进程配置与设置");
    }

    // 4. 纠正「已安装」与磁盘状态不一致
    this.reconcileInstalledFlag();

    // 5. 应用高亮双链样式
    applyWikilinkStyle(this.settings);

    // 6. 注册设置标签页
    this.addSettingTab(new LocalRunnerSettingTab(this.app, this));

    // 7. 注册视图类型与工厂,保证已持久化的 leaf 能正确反序列化
    this.registerView(RUNNER_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      const view = new RunnerView(leaf, this.buildViewOptions());
      view.setTabsFromConfigs(this.savedConfigs);
      return view;
    });

    // 8. 功能区图标:点击打开侧边栏
    this.addRibbonIcon("play", "本地进程", () => {
      void this.activateView();
    });

    // 9. 命令面板入口
    this.addCommand({
      id: "open",
      name: "打开本地进程侧边栏",
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

    // 复用已存在的 leaf,否则在右侧栏新建一个
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(RUNNER_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: RUNNER_VIEW_TYPE, active: true });
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

  /** 根据设置开关添加/移除高亮双链 body class */
  applyWikilinkStyle(): void {
    applyWikilinkStyle(this.settings);
  }

  // ---- 内部辅助 --------------------------------------------------------------

  /** 视图初始化参数 */
  private buildViewOptions(): ViewOptions {
    return {
      defaultCwd: this.getDefaultCwd(),
      settings: this.settings,
      onSaveConfigs: (configs) => {
        this.savedConfigs = configs;
        void this.saveSettings();
      },
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
