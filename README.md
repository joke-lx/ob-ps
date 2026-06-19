# Local Runner

在 Obsidian 右侧栏启动本地 shell 命令并实时查看输出,每个命令一个 tab,适合边写文档边跑 `npm run dev` / `npx vite` / 任意 CLI 工具。

![screenshot](docs/screenshot.png)

## 功能

- 🖥️ **多 tab 进程管理** — 同时跑多个命令,每个 tab 独立显示输出
- 📺 **侧边栏集成** — 不用切换窗口,在 Obsidian 内直接看日志
- ⏹️ **手动终止** — 跑飞的进程可以随时 Stop
- 🔄 **实时流式输出** — stdout / stderr 实时刷新,无延迟
- 🪟 **支持任意命令** — 任何能在 shell 里跑的东西(`npm run dev` / `pytest` / `cargo run` ...)

## 安装

### 方式 1:从 Obsidian 社区插件市场安装(发布后可用)

1. Obsidian → **Settings → Community plugins → Browse**
2. 搜索 `Local Runner`
3. 点击 **Install**,然后 **Enable**

### 方式 2:从 GitHub Release 手动安装

1. 去 [Releases 页面](https://github.com/joke-lx/ob-ps/releases) 下载最新的 `main.js`、`manifest.json`、`styles.css`
2. 在你的 vault 下创建文件夹:`.obsidian/plugins/local-runner/`
3. 把三个文件放进去
4. Obsidian → **Settings → Community plugins** → 刷新,启用 **Local Runner**

## 使用

1. 打开命令面板(`Ctrl/Cmd + P`),搜 `打开本地进程侧边栏`
2. 或点击左侧 ribbon 的终端图标
3. 在底部输入框敲命令 → 按 Enter 启动
4. 同一个侧边栏可以开多个 tab 跑不同进程
5. 停止:点 tab 标题旁的 `■`

## 安全提示

- 本插件用 `child_process.spawn` 启动本地 shell,等价于你在终端里手敲那条命令
- **不要**用它跑来历不明的命令或解析未信任的输入(和终端一样)
- 进程在工作目录执行,vault 根目录下子进程默认继承 Obsidian 的工作目录
- 终止进程只杀子进程,不清理它派生的孙进程(和终端 `Ctrl+C` 行为一致)

## 兼容性

- **仅桌面端**(用 `child_process`,移动端沙箱不支持)
- Obsidian ≥ 1.4.0

## 开发

```bash
npm install          # 装依赖
npm run dev          # 监听模式,改完代码自动重建
npm run build        # 生产构建,产物 = 根目录的 main.js
```

dev 模式会把构建产物同步到同级 vault 的 `.obsidian/plugins/local-runner/`,方便本地热加载。
prod/CI 模式只输出到源码根目录,由 GitHub Actions 打包成 release。

## 发布流程

1. 修改 `manifest.json` 的 `version`(SemVer)并同步更新 `versions.json`
2. `git commit && git push`
3. 打 tag(必须等于 `manifest.json` 里的 `version`,不带 `v` 前缀):
   ```bash
   git tag 1.0.1
   git push origin 1.0.1
   ```
4. GitHub Actions 自动构建并创建 draft release
5. 去 GitHub 编辑 release notes → Publish
6. 去 [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) 开 PR,在 `community-plugins.json` 加一条

## 许可

ISC — 见 [LICENSE](LICENSE)。
