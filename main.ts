import {
  FileSystemAdapter,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
} from "obsidian";
import {
  RUNNER_VIEW_TYPE,
  RunnerView,
  type PluginSettings,
  type ProcessConfig,
  type ViewOptions,
} from "./src/view";

// ---- 插件设置 ---------------------------------------------------------------

export const DEFAULT_SETTINGS: PluginSettings = {
  confirmBeforeDelete: true,
  autoScrollOutput: true,
  maxOutputChars: 200_000,
};

/** 编程方式跳转到设置标签页(内部 API) */
interface AppWithSetting {
  setting: { open(): Promise<void>; openTabById(id: string): void };
}

/** 持久化插件数据格式 */
interface PluginData {
  processes: ProcessConfig[];
  settings?: PluginSettings;
}

// ---- 设置标签页 --------------------------------------------------------------

class LocalRunnerSettingTab extends PluginSettingTab {
  private readonly plugin: LocalRunnerPlugin;

  constructor(app: import("obsidian").App, plugin: LocalRunnerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Local runner 设置").setHeading();

    new Setting(containerEl)
      .setName("删除前确认")
      .setDesc("点击删除进程图标时弹出确认提示")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.confirmBeforeDelete)
          .onChange(async (v) => {
            this.plugin.settings.confirmBeforeDelete = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("输出自动滚动")
      .setDesc("新内容输出时自动滚动到控制台底部")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.autoScrollOutput)
          .onChange(async (v) => {
            this.plugin.settings.autoScrollOutput = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("输出缓冲上限")
      .setDesc("单个进程保留的最大输出字符数(越大越占内存)")
      .addSlider((s) =>
        s
          .setLimits(10_000, 500_000, 10_000)
          .setValue(this.plugin.settings.maxOutputChars)
          .onChange(async (v) => {
            this.plugin.settings.maxOutputChars = v;
            await this.plugin.saveSettings();
          }),
      );
  }
}

// ---- 插件入口 ---------------------------------------------------------------

/**
 * Local Runner —— Obsidian 侧边栏插件。
 * 在侧边栏中启动本地 shell 命令(如 `npm run dev`),并按进程分列实时输出。
 *
 * 仅桌面端可用:依赖 Node 的 `child_process`,移动端沙箱不提供该能力。
 */
export default class LocalRunnerPlugin extends Plugin {
  /** 已保存的进程配置,view 构造时传入 */
  private savedConfigs: ProcessConfig[] = [];
  /** 设置 */
  settings: PluginSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    // 加载持久化数据
    const data = (await this.loadData()) as PluginData | null;
    this.savedConfigs = data?.processes ?? [];
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);

    // 注册设置标签页
    this.addSettingTab(new LocalRunnerSettingTab(this.app, this));

    // 注册视图类型与工厂,保证已持久化的 leaf 能正确反序列化
    this.registerView(RUNNER_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      const view = new RunnerView(leaf, this.buildViewOptions());
      view.setTabsFromConfigs(this.savedConfigs);
      return view;
    });

    // 功能区图标:点击打开侧边栏
    this.addRibbonIcon("terminal", "本地进程", () => {
      void this.activateView();
    });

    // 命令面板入口
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
    const app = this.app as AppWithSetting;
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
  }

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

  /** 取 vault 根目录作为命令的默认工作目录 */
  private getDefaultCwd(): string {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
  }
}
