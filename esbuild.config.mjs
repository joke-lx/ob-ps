/**
 * esbuild 构建脚本 —— 用于打包 Obsidian 插件 (local-runner)
 */

import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prod = process.argv[2] === "--production";

// ---- 输出路径 ----

/** 本地产物路径(写入项目根目录) */
const localOutFile = path.join(__dirname, "main.js");

/** vault 插件目录 */
const vaultPluginDir = process.env.LOCAL_RUNNER_VAULT
  ? path.resolve(process.env.LOCAL_RUNNER_VAULT)
  : path.resolve("D:\\code\\a_md\\obsidian_init", ".obsidian", "plugins", "local-runner");

const syncEnabled = true;

// ---- vendor external ----

const vendorExternal = [
  "obsidian",
  "electron",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
];

// ---- 同步工具函数 ----

async function syncToVault() {
  if (!syncEnabled) return;
  try {
    await mkdir(vaultPluginDir, { recursive: true });
    await Promise.all([
      copyFile(localOutFile, path.join(vaultPluginDir, "main.js")),
      copyFile(path.join(__dirname, "manifest.json"), path.join(vaultPluginDir, "manifest.json")),
      copyFile(path.join(__dirname, "styles.css"), path.join(vaultPluginDir, "styles.css")),
    ]);
    console.log("[sync] synced to " + vaultPluginDir);
  } catch (err) {
    console.error("[sync] failed: " + err.message);
  }
}

// ---- esbuild ----

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: [...vendorExternal, ...builtinModules],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: localOutFile,
  plugins: [
    {
      name: "sync-to-vault",
      setup(build) {
        build.onEnd(async () => {
          await syncToVault();
        });
      },
    },
  ],
});

if (prod) {
  await context.rebuild();
  await context.dispose();
  process.exit(0);
} else {
  await context.watch();
}
