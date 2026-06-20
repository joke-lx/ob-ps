# Local Runner

Run local shell commands from an Obsidian sidebar tab with live, per-process output. Each command gets its own card with a status indicator and expandable log — perfect for keeping `npm run dev` or `npx vite` running while you write notes.

在 Obsidian 侧边栏管理本地 shell 进程并实时查看输出。每个进程一条记录，带状态指示灯、可展开日志，支持命令组快捷填充 —— 适合边写文档边跑 `npm run dev` / `npx vite` / 任意 CLI 工具。

## Features

- 🖥️ **Multiple processes in parallel** — run several commands at once, each with its own output panel
- 📺 **Sidebar integration** — watch logs without leaving Obsidian
- 🟢 **Status indicator** — running / stopped / exited (with exit code) at a glance
- ▶️ **One-click start & stop** — click the process card to toggle
- 📝 **Inline form** — create / edit a process (name / command / working directory); `Enter` to submit, `Esc` to cancel
- 🔁 **Live streaming output** — stdout / stderr merged, auto-scroll to bottom
- 📂 **Expand / collapse** — each process log can be expanded independently
- 💾 **Persisted** — process configurations and settings survive Obsidian restarts
- ✏️ **Edit / delete** — change commands or clean up anytime
- 🗂️ **Command groups** — define reusable presets in settings; the new-process form offers a two-level "group → preset" dropdown to fill the form with one click
- 🔧 **Wikilink-repair skill installer** — copy the bundled `obsidian-repair-unresolved-links` skill to your vault's `.claude/skills/` with one toggle
- 🎨 **Highlighted wikilinks** — give internal `[[]]` links a more readable style
- 🪟 **Windows process tree kill** — `taskkill /T /F` so dev servers don't keep your port
- 🎯 **ANSI stripped** — output is plain text, capped at 200k chars to bound memory

## Installation

### Option 1: From the Obsidian Community Plugin store (after publication)

1. Open Obsidian → **Settings → Community plugins → Browse**
2. Search for `Local Runner`
3. Click **Install**, then **Enable**

### Option 2: From a GitHub Release

1. Download the latest release from the [Releases page](https://github.com/joke-lx/ob-ps/releases)
2. In your vault, create the folder `.obsidian/plugins/local-runner/`
3. Copy `main.js`, `manifest.json`, and `styles.css` into it (or unzip the release zip)
4. In Obsidian → **Settings → Community plugins**, reload, and enable **Local Runner**

## Usage

1. Open the sidebar: command palette (`Ctrl/Cmd + P`) → "Open local process sidebar", or click the terminal icon in the left ribbon
2. Create a process: click **＋** in the sidebar header, fill in name / command / working directory → `Enter` (or click "Run")
3. Start / stop a process: click the process **card** to toggle
4. View output: click the **▾** on the right of the card to expand the log
5. Edit / delete: click the ✏ / × on the right of the card
6. Quick fill: when creating, pick a group in the "Command group" dropdown, then a preset — the form auto-fills

## Settings

Open **Settings → Local Runner**:

- **Command groups** — add / remove command groups and presets, reorder via ↑ / ↓
- **Install wikilink-repair skill** — toggle: install the skill to / remove it from your vault
- **Highlight wikilinks** — toggle: highlight internal wikilinks in your notes

## Security

- This plugin launches commands via `child_process.spawn` with `shell: true`, equivalent to typing them in a terminal — pipes, arguments, and shell syntax are all supported
- **Do not** use it to run untrusted commands or parse untrusted input (same risk as a terminal)
- The default working directory is the vault root; child processes inherit Obsidian's environment
- On Windows, stopping a process kills the whole process tree; on other platforms only the direct child receives `SIGTERM`

## Compatibility

- **Desktop only** (depends on Node's `child_process`; mobile sandboxes do not provide it)
- Obsidian ≥ 1.7.2

## Development

```bash
npm install          # install dependencies
npm run dev          # watch mode, rebuilds on change
npm run build        # type check + production build; output = main.js at repo root
npm run lint         # eslint static check
```

In dev mode, `main.js` / `manifest.json` / `styles.css` and `.claude/skills/obsidian-repair-unresolved-links` are synced to the vault plugin directory for hot reload. Default target is `../<vault>/.obsidian/plugins/local-runner/`. Override with the environment variable:

```bash
LOCAL_RUNNER_VAULT=/path/to/vault/.obsidian/plugins/local-runner npm run dev
```

Production mode only writes to the repo root and lets CI handle packaging.

## Release

Fully automated: every push to `main` runs GitHub Actions, which will

1. Auto-bump the patch version in `manifest.json` and sync `versions.json`
2. Type-check and build
3. Package `local-runner-<version>.zip` (containing `main.js` / `manifest.json` / `styles.css`)
4. Commit the version bump (with `[skip ci]` to avoid loops), tag it, and create a GitHub Release

So for day-to-day development you only need `git push origin main` — no manual version bumps or tags.

> Submitting to the Obsidian community store is a separate step: open a PR against [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) and add an entry to `community-plugins.json`.

## License

ISC — see [LICENSE](LICENSE).

## 功能

**进程管理**

- 🖥️ **多进程并行** — 同一侧边栏同时跑多个命令，各自独立显示输出
- 📺 **侧边栏集成** — 不切窗口，Obsidian 内直接看日志
- 🟢 **状态指示灯** — 运行中 / 已停止 / 已退出（含退出码）一目了然
- ▶️ **一键启停** — 点击进程卡片即可启动或停止
- 📝 **内联表单** — 新建 / 编辑进程（名称 / 命令 / 工作目录），`Enter` 提交、`Esc` 取消
- 🔁 **实时流式输出** — stdout / stderr 合并实时刷新，自动滚动到底
- 📂 **展开 / 收起** — 每个进程的输出可独立展开查看
- 💾 **持久化** — 进程配置与设置自动保存，重启 Obsidian 不丢
- ✏️ **编辑 / 删除** — 随时改命令或清理不需要的进程

**快捷命令组**

- 🗂️ 在设置里定义「命令组」，每组可含多条预设（名称 + 命令 + 工作目录）
- ⚡ 新建进程时通过两级下拉「组 → 预设」一键填充，省去重复输入

**附加能力（面向 Claude Code 用户）**

- 🔧 **双链修复 skill 安装** — 一键把插件自带的 `obsidian-repair-unresolved-links` skill 复制到 vault 的 `.claude/skills/`，用于自动补全未解析的 `[[]]` 双链
- 🎨 **高亮双链样式** — 开启后笔记中的内部双链以更醒目的样式显示

**底层细节**

- Windows 上终止进程用 `taskkill /T /F` **杀掉整棵进程树**（避免 dev server 占用端口）；其他平台退化为 `SIGTERM`
- 自动剥离 ANSI 颜色转义，输出缓冲上限 200k 字符（防止长时间运行的服务吃满内存）

## 安装

### 方式 1：从 Obsidian 社区插件市场安装（发布后可用）

1. Obsidian → **Settings → Community plugins → Browse**
2. 搜索 `Local Runner`
3. 点击 **Install**，然后 **Enable**

### 方式 2：从 GitHub Release 手动安装

1. 去 [Releases 页面](https://github.com/joke-lx/ob-ps/releases) 下载最新版
2. 在你的 vault 下创建文件夹：`.obsidian/plugins/local-runner/`
3. 把 `main.js`、`manifest.json`、`styles.css` 三个文件放进去（直接用 Release 里的 zip 解压也行）
4. Obsidian → **Settings → Community plugins** → 刷新，启用 **Local Runner**

## 使用

1. 打开侧边栏：命令面板（`Ctrl/Cmd + P`）搜 `打开本地进程侧边栏`，或点左侧 ribbon 的终端图标
2. 新建进程：点侧边栏头部的 **＋**，填名称 / 命令 / 工作目录 → `Enter`（或点「运行」）
3. 启停进程：点进程**卡片**切换运行 / 停止
4. 查看输出：点卡片右侧的 **▾** 展开日志
5. 编辑 / 删除：点卡片右侧的 ✏ / ×
6. 快捷填充：新建时先在「快捷命令组」下拉里选组，再选预设，表单自动填好

## 设置

打开 **Settings → Local Runner**：

- **命令组管理** — 增删命令组与命令预设，支持上下排序
- **添加双链修复 skill** — 开关：把 skill 装到 / 从 vault 移除
- **高亮双链样式** — 开关：高亮笔记中的内部双链

## 安全提示

- 本插件用 `child_process.spawn`（`shell: true`）启动命令，等价于你在终端里手敲那条命令 —— 支持管道、参数等任意 shell 语法
- **不要**用它跑来历不明的命令或解析未信任的输入（和终端一样）
- 工作目录默认为 vault 根目录，子进程继承 Obsidian 的环境变量
- Windows 终止进程会杀掉整棵进程树（含派生子进程）；其他平台仅向直接子进程发 `SIGTERM`

## 兼容性

- **仅桌面端**（依赖 Node 的 `child_process`，移动端沙箱不支持）
- Obsidian ≥ 1.7.2

## 开发

```bash
npm install          # 装依赖
npm run dev          # 监听模式，改完自动重建
npm run build        # 类型检查 + 生产构建，产物 = 根目录 main.js
npm run lint         # eslint 静态检查
```

dev 模式会把 `main.js` / `manifest.json` / `styles.css` 以及 `.claude/skills/obsidian-repair-unresolved-links` 同步到 vault 插件目录，方便热加载。默认目标为 `../<vault>/.obsidian/plugins/local-runner/`，可用环境变量覆盖：

```bash
LOCAL_RUNNER_VAULT=/path/to/vault/.obsidian/plugins/local-runner npm run dev
```

prod 模式只输出到源码根目录，由 CI 打包发布。

## 发布流程

发布全自动：每次 push 到 `main`，GitHub Actions 会：

1. 自动递增 `manifest.json` 的 patch 版本并同步 `versions.json`
2. 类型检查 + 构建
3. 打包 `local-runner-<version>.zip`（含 `main.js` / `manifest.json` / `styles.css`）
4. 提交版本号（带 `[skip ci]` 防循环）、打 tag、创建 GitHub Release

所以日常开发只需 `git push origin main`，无需手动改版本号或打 tag。

> 提交到 Obsidian 社区市场是另一回事：首次发布需去 [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) 开 PR，在 `community-plugins.json` 加一条。

## 许可

ISC — 见 [LICENSE](LICENSE)。
