import { FileSystemAdapter, Plugin, WorkspaceLeaf } from "obsidian";
import {
  RUNNER_VIEW_TYPE,
  RunnerView,
  type ProcessConfig,
  type ViewOptions,
} from "./src/view";

/** 持久化插件数据格式 */
interface PluginData {
  processes: ProcessConfig[];
}

/**
 * Local Runner —— Obsidian 侧边栏插件。
 * 在侧边栏中启动本地 shell 命令(如 `npm run dev`),并按进程分列实时输出。
 *
 * 仅桌面端可用:依赖 Node 的 `child_process`,移动端沙箱不提供该能力。
 */
export default class LocalRunnerPlugin extends Plugin {
  /** 已保存的进程配置,view 构造时传入 */
  private savedConfigs: ProcessConfig[] = [];

  async onload(): Promise<void> {
    // 先加载持久化配置,再注册视图工厂
    const data = await this.loadData() as PluginData | null;
    this.savedConfigs = data?.processes ?? [];

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

  private buildViewOptions(): ViewOptions {
    return {
      defaultCwd: this.getDefaultCwd(),
      onSaveConfigs: (configs) => {
        this.savedConfigs = configs;
        void this.saveData({ processes: configs });
      },
    };
  }

  /** 取 vault 根目录作为命令的默认工作目录 */
  private getDefaultCwd(): string {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
  }
}
