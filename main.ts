import { FileSystemAdapter, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from "obsidian";
import * as path from "path";
import * as fs from "fs";
import {
  RUNNER_VIEW_TYPE,
  RunnerView,
  type CommandGroup,
  type PluginSettings,
  type ProcessConfig,
  type ViewOptions,
} from "./src/view";

// ---- 插件设置 ---------------------------------------------------------------

export const DEFAULT_SETTINGS: PluginSettings = {
  repairLinksSkillInstalled: false,
  highlightWikilinks: false,
  keepDataOnUninstall: false,
  commandGroups: [],
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

// ---- 工具函数 ---------------------------------------------------------------

const SKILL_NAME = "obsidian-repair-unresolved-links";

/** 获取插件在 vault 中的安装目录(绝对路径) */
function getPluginInstallDir(plugin: LocalRunnerPlugin): string {
  const vault = plugin.getDefaultCwd();
  const rel = plugin.manifest.dir;
  if (rel) {
    return path.join(vault, rel);
  }
  // fallback: vault 配置目录 + plugins/插件名
  return path.join(vault, plugin.app.vault.configDir, "plugins", plugin.manifest.id);
}

/** 插件自带的 skill 源目录(位于插件安装目录下的 .claude/skills/) */
function getSkillSourceDir(plugin: LocalRunnerPlugin): string {
  return path.join(getPluginInstallDir(plugin), ".claude", "skills", SKILL_NAME);
}

/** 仓库目标的 .claude/skills 目录 */
function getSkillDestDir(vaultPath: string): string {
  return path.join(vaultPath, ".claude", "skills", SKILL_NAME);
}

/** 安装 skill: 将插件自带的 skill 目录复制到仓库 */
function installSkill(plugin: LocalRunnerPlugin): boolean {
  const vault = plugin.getDefaultCwd();
  if (!vault) {
    new Notice("无法获取 vault 路径");
    return false;
  }

  const src = getSkillSourceDir(plugin);
  const dest = getSkillDestDir(vault);

  if (!fs.existsSync(src)) {
    new Notice(`未找到 skill 源目录: ${src}`);
    return false;
  }

  try {
    // 如果目标已存在则先删除,保证覆盖
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    // 确保父目录存在
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    new Notice("✅ 双链修复 skill 已安装到仓库");
    return true;
  } catch (err) {
    new Notice(`❌ 安装 skill 失败: ${(err as Error).message}`);
    return false;
  }
}

/** 卸载 skill: 删除仓库中的 skill 目录 */
function uninstallSkill(plugin: LocalRunnerPlugin): boolean {
  const vault = plugin.getDefaultCwd();
  if (!vault) return true;

  const dest = getSkillDestDir(vault);

  if (!fs.existsSync(dest)) {
    return true;
  }

  try {
    fs.rmSync(dest, { recursive: true, force: true });
    new Notice("已移除双链修复 skill");
    return true;
  } catch (err) {
    new Notice(`❌ 移除 skill 失败: ${(err as Error).message}`);
    return false;
  }
}

let _groupIdCounter = 0;
function nextGroupId(): string {
  _groupIdCounter += 1;
  return `g-${Date.now().toString(36)}-${_groupIdCounter}`;
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

    new Setting(containerEl).setName("设置").setHeading();

    // ---- 双链修复 skill ----
    new Setting(containerEl)
      .setName("添加双链修复 skill")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("将 ");
          frag.createEl("code", { text: SKILL_NAME });
          frag.appendText(" skill 安装到仓库 .claude/skills 目录,用于自动补全未解析的双链");
        }),
      )
      .addToggle((t) => {
        t.setValue(this.plugin.settings.repairLinksSkillInstalled).onChange(
          (v) => {
            if (v) {
              const ok = installSkill(this.plugin);
              this.plugin.settings.repairLinksSkillInstalled = ok;
            } else {
              uninstallSkill(this.plugin);
              this.plugin.settings.repairLinksSkillInstalled = false;
            }
            void this.plugin.saveSettings();
            t.setValue(this.plugin.settings.repairLinksSkillInstalled);
          },
        );
      });

    // ---- 高亮双链样式 ----
    new Setting(containerEl)
      .setName("高亮双链样式")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("开启后,笔记中的内部双链（");
          frag.createEl("code", { text: "[[" });
          frag.appendText(" 链接");
          frag.createEl("code", { text: "]]" });
          frag.appendText("）将以高亮样式显示,更醒目美观");
        }),
      )
      .addToggle((t) => {
        t.setValue(this.plugin.settings.highlightWikilinks).onChange(
          (v) => {
            this.plugin.settings.highlightWikilinks = v;
            this.plugin.applyWikilinkStyle();
            void this.plugin.saveSettings();
          },
        );
      });

    // ---- 卸载时保留数据 ----
    new Setting(containerEl)
      .setName("卸载插件时保留数据")
      .setDesc(
        createFragment((frag) => {
          frag.appendText(
            "开启后,进程配置与设置会额外备份到 vault 中(独立于插件目录,卸载不会被清理);重新安装插件时自动恢复。关闭此开关会清除已有备份。",
          );
        }),
      )
      .addToggle((t) => {
        t.setValue(this.plugin.settings.keepDataOnUninstall).onChange(
          (v) => {
            this.plugin.settings.keepDataOnUninstall = v;
            void this.plugin.saveSettings().then(() => {
              new Notice(v ? "✅ 已开启:卸载时保留数据" : "已关闭,并清除备份");
            });
          },
        );
      });

    // ---- 命令组管理 ----
    new Setting(containerEl).setName("命令组管理").setHeading();
    containerEl.createDiv({
      cls: "setting-item-description",
      text: "定义快捷命令组,新建进程时可通过下拉列表快速填充命令",
    });

    const groups = this.plugin.settings.commandGroups;
    for (let gi = 0; gi < groups.length; gi++) {
      this.renderGroupEditor(groups, gi);
    }

    new Setting(containerEl).addButton((b) =>
      b
        .setButtonText("＋ 添加命令组")
        .setCta()
        .onClick(() => {
          groups.push({ id: nextGroupId(), name: "新命令组", presets: [] });
          void this.plugin.saveSettings().then(() => this.refreshDisplay());
        }),
    );
  }

  /** 刷新设置 UI(display 已弃用,用此方法统一包装) */
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  private refreshDisplay(): void { this.display(); }

  /** 渲染单个命令组的编辑器 */
  private renderGroupEditor(groups: CommandGroup[], gi: number): void {
    const { containerEl } = this;
    const group = groups[gi];

    const wrap = containerEl.createDiv({ cls: "setting-group-card" });

    // ---- 组头: 名称 + 操作按钮 ----
    const headerRow = wrap.createDiv({ cls: "setting-group-header" });

    const nameInput = headerRow.createEl("input", {
      cls: "setting-group-name-input",
      attr: { placeholder: "组名称,如 dev server" },
    });
    nameInput.value = group.name;
    nameInput.addEventListener("change", () => {
      group.name = nameInput.value;
      void this.plugin.saveSettings();
    });

    const btnRow = headerRow.createDiv({ cls: "setting-group-actions" });

    if (gi > 0) {
      const upBtn = btnRow.createEl("button", {
        cls: "setting-group-btn",
        text: "↑",
        attr: { title: "上移" },
      });
      upBtn.addEventListener("click", () => {
        [groups[gi], groups[gi - 1]] = [groups[gi - 1], groups[gi]];
        void this.plugin.saveSettings().then(() => this.refreshDisplay());
      });
    }
    if (gi < groups.length - 1) {
      const downBtn = btnRow.createEl("button", {
        cls: "setting-group-btn",
        text: "↓",
        attr: { title: "下移" },
      });
      downBtn.addEventListener("click", () => {
        [groups[gi], groups[gi + 1]] = [groups[gi + 1], groups[gi]];
        void this.plugin.saveSettings().then(() => this.refreshDisplay());
      });
    }

    const delBtn = btnRow.createEl("button", {
      cls: "setting-group-btn is-danger",
      text: "✕",
      attr: { title: "删除组" },
    });
    delBtn.addEventListener("click", () => {
      groups.splice(gi, 1);
      void this.plugin.saveSettings().then(() => this.refreshDisplay());
    });

    // ---- 预设列表 ----
    const presetsWrap = wrap.createDiv({ cls: "setting-presets" });
    for (let pi = 0; pi < group.presets.length; pi++) {
      this.renderPresetEditor(groups, gi, pi, presetsWrap);
    }

    // 添加预设按钮
    const addPresetBtn = wrap.createEl("button", {
      cls: "setting-group-btn is-add",
      text: "＋ 添加命令",
      attr: { title: "添加命令预设" },
    });
    addPresetBtn.addEventListener("click", () => {
      group.presets.push({ name: "", command: "", cwd: "" });
      void this.plugin.saveSettings().then(() => this.refreshDisplay());
    });
  }

  /** 渲染单条命令预设的编辑器 */
  private renderPresetEditor(
    groups: CommandGroup[],
    gi: number,
    pi: number,
    wrap: HTMLElement,
  ): void {
    const preset = groups[gi].presets[pi];

    const row = wrap.createDiv({ cls: "setting-preset-row" });

    // 名
    const nameCol = row.createDiv({ cls: "setting-preset-col" });
    nameCol.createDiv({ cls: "setting-preset-label", text: "名称" });
    const nameInput = nameCol.createEl("input", {
      cls: "setting-preset-input",
      attr: { placeholder: "显示名称" },
    });
    nameInput.value = preset.name;
    nameInput.addEventListener("change", () => {
      preset.name = nameInput.value;
      void this.plugin.saveSettings();
    });

    // 命令
    const cmdCol = row.createDiv({ cls: "setting-preset-col is-grow" });
    cmdCol.createDiv({ cls: "setting-preset-label", text: "命令" });
    const cmdInput = cmdCol.createEl("input", {
      cls: "setting-preset-input is-mono",
      attr: { placeholder: "npm run dev" },
    });
    cmdInput.value = preset.command;
    cmdInput.addEventListener("change", () => {
      preset.command = cmdInput.value;
      void this.plugin.saveSettings();
    });

    // 工作目录
    const cwdCol = row.createDiv({ cls: "setting-preset-col is-grow" });
    cwdCol.createDiv({ cls: "setting-preset-label", text: "工作目录" });
    const cwdInput = cwdCol.createEl("input", {
      cls: "setting-preset-input is-mono",
      attr: { placeholder: "默认为 vault 根目录" },
    });
    cwdInput.value = preset.cwd;
    cwdInput.addEventListener("change", () => {
      preset.cwd = cwdInput.value;
      void this.plugin.saveSettings();
    });

    // 删除
    const actCol = row.createDiv({ cls: "setting-preset-col is-action" });
    const delBtn = actCol.createEl("button", {
      cls: "setting-group-btn is-danger",
      text: "✕",
      attr: { title: "删除此预设" },
    });
    delBtn.addEventListener("click", () => {
      groups[gi].presets.splice(pi, 1);
      void this.plugin.saveSettings().then(() => this.refreshDisplay());
    });
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
    let data = (await this.loadData()) as PluginData | null;

    // 主数据缺失(卸载/重装后)时,尝试从 vault 级备份恢复
    let restored = false;
    if (data === null) {
      const backup = this.restoreDataBackup();
      if (backup) {
        data = { processes: backup.processes, settings: backup.settings };
        restored = true;
      }
    }

    this.savedConfigs = data?.processes ?? [];
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);

    // 恢复成功后立即写回主数据位置,使后续 loadData 命中
    if (restored) {
      await this.saveSettings();
      new Notice("✅ 已从备份恢复进程配置与设置");
    }

    // 如果已安装但目标不存在,自动修正状态
    if (this.settings.repairLinksSkillInstalled) {
      const vault = this.getDefaultCwd();
      if (vault && !fs.existsSync(getSkillDestDir(vault))) {
        this.settings.repairLinksSkillInstalled = false;
        void this.saveSettings();
      }
    }

    // 应用高亮双链样式
    this.applyWikilinkStyle();

    // 注册设置标签页
    this.addSettingTab(new LocalRunnerSettingTab(this.app, this));

    // 注册视图类型与工厂,保证已持久化的 leaf 能正确反序列化
    this.registerView(RUNNER_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      const view = new RunnerView(leaf, this.buildViewOptions());
      view.setTabsFromConfigs(this.savedConfigs);
      return view;
    });

    // 功能区图标:点击打开侧边栏
    this.addRibbonIcon("play", "本地进程", () => {
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
    if (this.settings.keepDataOnUninstall) {
      this.writeDataBackup();
    } else {
      this.removeDataBackup();
    }
  }

  /** 数据备份文件名,存放在 vault 的 .obsidian 目录下(卸载插件时不会被清理) */
  private static readonly BACKUP_FILE = "local-runner-backup.json";

  /** 数据备份文件绝对路径 */
  private getDataBackupPath(): string {
    const vault = this.getDefaultCwd();
    return path.join(vault, this.app.vault.configDir, LocalRunnerPlugin.BACKUP_FILE);
  }

  /** 将当前持久化数据写入 vault 级备份 */
  private writeDataBackup(): void {
    const vault = this.getDefaultCwd();
    if (!vault) {
      return;
    }
    try {
      const backupPath = this.getDataBackupPath();
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.writeFileSync(
        backupPath,
        JSON.stringify({ processes: this.savedConfigs, settings: this.settings }),
        "utf8",
      );
    } catch (err) {
      new Notice(`❌ 写入数据备份失败: ${(err as Error).message}`);
    }
  }

  /** 删除 vault 级备份(若存在) */
  private removeDataBackup(): void {
    const backupPath = this.getDataBackupPath();
    try {
      if (fs.existsSync(backupPath)) {
        fs.rmSync(backupPath, { force: true });
      }
    } catch (err) {
      new Notice(`❌ 清除数据备份失败: ${(err as Error).message}`);
    }
  }

  /** 从 vault 级备份读取持久化数据,读取后即删除备份(一次性恢复) */
  private restoreDataBackup(): {
    processes: ProcessConfig[];
    settings?: PluginSettings;
  } | null {
    const backupPath = this.getDataBackupPath();
    if (!fs.existsSync(backupPath)) {
      return null;
    }
    try {
      const raw = fs.readFileSync(backupPath, "utf8");
      const parsed = JSON.parse(raw) as {
        processes?: ProcessConfig[];
        settings?: PluginSettings;
      };
      // 恢复后删除备份,避免后续卸载时残留
      fs.rmSync(backupPath, { force: true });
      return { processes: parsed.processes ?? [], settings: parsed.settings };
    } catch (err) {
      new Notice(`❌ 恢复数据备份失败: ${(err as Error).message}`);
      return null;
    }
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
  getDefaultCwd(): string {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
  }

  /** 根据设置开关添加/移除高亮双链 body class */
  applyWikilinkStyle(): void {
    if (this.settings.highlightWikilinks) {
      document.body.addClass("ob-ps-hl-wl");
    } else {
      document.body.removeClass("ob-ps-hl-wl");
    }
  }
}
