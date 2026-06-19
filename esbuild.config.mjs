/**
 * esbuild 构建脚本 —— 用于打包 Obsidian 插件 (local-runner)
 *
 * 主要职责:
 *   1. 将 TypeScript 入口 main.ts 及其所有依赖打包为 CommonJS 格式的 main.js
 *   2. 把构建产物写入当前源码根目录(供 CI release.yml 上传为 release assets),
 *      开发模式下额外同步一份到同级 vault 的插件目录,便于本地 Obsidian 热加载。
 *   3. 在打包前/后同步静态资源 (manifest.json、styles.css)
 *   4. 通过命令行参数区分生产构建 (--production) 与开发监听 (watch) 两种模式
 */

import esbuild from "esbuild";
import builtins from "builtin-modules";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ESM 中没有 __dirname,需要从 import.meta.url 反推出当前文件所在目录
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 判断是否为生产构建:命令行传入 --production 时为 true,否则进入开发监听模式
const prod = process.argv[2] === "--production";

// 输出目录策略:
//   - 生产构建 (含 CI): 输出到当前源码根目录,这样 `release.yml` 能直接
//     将 main.js、manifest.json、styles.css 打包为 release assets。
//   - 开发监听: 输出到源码根目录,同时把构建产物同步到同级 vault 的
//     插件目录,便于本地 Obsidian 直接热加载。
const localOutFile = path.join(__dirname, "main.js");
const vaultOutDir = path.resolve(__dirname, "..", "123", ".obsidian", "plugins", "local-runner");
const syncToVault = !prod;

// 需要作为 external 处理的依赖:
//   这些模块由 Obsidian 的 Electron 运行时直接注入到全局,打包时不应将它们
//   打进 bundle,否则不仅冗余,还可能与宿主环境产生冲突。
const vendorExternal = [
  "obsidian",                 // Obsidian 插件 API
  "electron",                 // Electron 运行时
  "@codemirror/autocomplete",  // CodeMirror 子模块
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",            // CodeMirror 底层解析器
  "@lezer/highlight",
  "@lezer/lr",
];

// 创建 esbuild 上下文,统一管理构建配置
const context = await esbuild.context({
  entryPoints: ["main.ts"],                          // 入口文件
  bundle: true,                                      // 启用打包,把依赖合并到单文件
  // Node 内建模块 (如 child_process、path 等) 与上述 vendor 模块都保持为外部 require,
  // 它们由 Obsidian 的 Node-enabled Electron 运行时负责提供。
  external: [...vendorExternal, ...builtins],
  format: "cjs",                                     // 输出 CommonJS 格式,符合 Obsidian 插件规范
  target: "es2018",                                  // 目标语法版本
  logLevel: "info",                                  // 构建日志级别
  sourcemap: prod ? false : "inline",                // 生产构建不输出 sourcemap,开发模式内联便于调试
  treeShaking: true,                                 // 启用 tree-shaking,移除未引用的代码
  outfile: localOutFile,                             // 输出文件路径(始终落在源码根目录)
});

// 生产构建:把 main.js 写到源码根目录(供 release.yml 使用)
// 开发模式:除了 main.js,也拷贝一份到 vault 目录,让 Obsidian 直接热加载
if (syncToVault) {
  await mkdir(vaultOutDir, { recursive: true });
  const manifestSrc = path.join(__dirname, "manifest.json");
  const stylesSrc = path.join(__dirname, "styles.css");
  await Promise.all([
    copyFile(manifestSrc, path.join(vaultOutDir, "manifest.json")),
    copyFile(stylesSrc, path.join(vaultOutDir, "styles.css")),
  ]);
}

// 生产模式:执行一次完整构建后退出进程
// 开发模式:持续监听 main.ts 及其依赖的变化,触发增量重建 (适合本地实时调试)
if (prod) {
  await context.rebuild();
  await context.dispose();
  process.exit(0);
} else {
  await context.watch();
}