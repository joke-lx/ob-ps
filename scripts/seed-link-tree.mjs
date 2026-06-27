/**
 * scripts/seed-link-tree.mjs
 *
 * 从 Obsidian vault 读取笔记名列表，手动指定树结构生成 CreationEvent[] JSON。
 * 不再依赖自动主源选择（因为 ctime 不反映语义父子关系）。
 *
 * 用法：node scripts/seed-link-tree.mjs
 */

import fs from "node:fs";
import path from "node:path";

const VAULT_DIR  = "D:/DevProjects/my/test/test/obsidian/123";
const TARGET_DIR = "概率论";
/** 种子 JSON 写到插件 data.json —— Obsidian 标准数据位置 */
const OUTPUT     = path.join(VAULT_DIR, ".obsidian/plugins/local-runner/data.json");
const RUN_ID     = "seed";
const BASE_TS    = 1000000;

/**
 * 手动定义的树结构。
 * key = target 笔记名（去 .md），
 * value = { sourcePath, line, parent? }
 *   - sourcePath: 触发创建的源笔记（跳转锚点位置）
 *   - parent: 父节点的 target（省略则挂在 ghost 知识点下）
 *
 * 所有 sourcePath 下的事件共享 ghost 根"知识点"。
 */
const TREE = {
  // 第一层：挂 ghost 知识点下
  "一维随机变量及其分布": {
    sourcePath: "概率论/知识点.md",
    line: 3,
  },
  "概率论四大公式概念推导": {
    sourcePath: "概率论/知识点.md",
    line: 0,
  },
  "加法概率、古典概率、条件概率、全概率的区别，以及什么情况下使用": {
    sourcePath: "概率论/知识点.md",
    line: 1,
  },

  // 第二层：挂 一维随机变量 下
  "离散型随机变量": {
    sourcePath: "概率论/一维随机变量及其分布.md",
    line: 76,
    parent: "一维随机变量及其分布",
  },
  "常见题型": {
    sourcePath: "概率论/一维随机变量及其分布.md",
    line: 78,
    parent: "一维随机变量及其分布",
  },

  // 第三层：挂 常见题型 下
  "离散型随机变量求分布律": {
    sourcePath: "概率论/常见题型.md",
    line: 1,
    parent: "常见题型",
  },
  "离散型分布律求概率": {
    sourcePath: "概率论/常见题型.md",
    line: 3,
    parent: "常见题型",
  },
  "连续型R、V相关计算": {
    sourcePath: "概率论/常见题型.md",
    line: 6,
    parent: "常见题型",
  },

  // 第四层：挂 离散型分布律求概率 下
  "多维随机变量": {
    sourcePath: "概率论/离散型分布律求概率.md",
    line: 200,
    parent: "离散型分布律求概率",
  },

  // 第二层（b）：挂 概率论四大公式概念推导 下
  "为什么多阶段用全概率公式": {
    sourcePath: "概率论/概率论四大公式概念推导.md",
    line: 66,
    parent: "概率论四大公式概念推导",
  },
  "难点在于找什么是A，什么是B1、2、3": {
    sourcePath: "概率论/概率论四大公式概念推导.md",
    line: 68,
    parent: "概率论四大公式概念推导",
  },
  "阶段必须按照时间关系，不能结果反推？为什么，和贝叶斯公式的根因在哪": {
    sourcePath: "概率论/概率论四大公式概念推导.md",
    line: 70,
    parent: "概率论四大公式概念推导",
  },
  "是不是还有伯努利概型，为什么没有写入": {
    sourcePath: "概率论/概率论四大公式概念推导.md",
    line: 95,
    parent: "概率论四大公式概念推导",
  },
};

function main() {
  // 按深度遍历：parent 先于 child 产生时间戳
  const visited = new Set();
  const events = [];
  let idx = 0;

  function add(target, entry) {
    if (visited.has(target)) return;
    visited.add(target);

    // 先处理父节点（如果存在）
    if (entry.parent) {
      const parentEntry = TREE[entry.parent];
      if (parentEntry) add(entry.parent, parentEntry);
    }

    idx++;
    events.push({
      id: `${RUN_ID}_p${idx}`,
      target,
      sourcePath: entry.sourcePath,
      position: { line: entry.line, col: 0 },
      firstSeenAt: BASE_TS + idx * 100,
      runId: RUN_ID,
    });
  }

  // 按 entry 定义顺序依次处理（自动保证父先于子）
  for (const [target, entry] of Object.entries(TREE)) {
    add(target, entry);
  }

  events.sort((a, b) => a.firstSeenAt - b.firstSeenAt);

  const seed = { events, version: 1 };

  // 合并到插件 data.json（保留 processes/settings），不覆盖整个文件
  let data = {};
  if (fs.existsSync(OUTPUT)) {
    try { data = JSON.parse(fs.readFileSync(OUTPUT, "utf8")); }
    catch (e) { console.warn("⚠️  data.json 解析失败，将新建"); }
  }
  data.linkTree = seed;
  fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2), "utf8");

  console.log(`✅ 已写入 ${events.length} 条事件 → ${OUTPUT}`);

  // 验证树结构
  const byTarget = new Map();
  for (const e of events) byTarget.set(e.target, e);
  console.log("\n树结构:");
  for (const e of events) {
    const pk = (e.sourcePath.split("/").pop() || e.sourcePath).replace(/\.md$/i, "");
    const p = byTarget.get(pk);
    const indent = p ? "  ".repeat(p.position.line) : "";
    console.log(`${indent}${e.target} ← ${p ? p.target : "ghost·知识点"} (ts:${String(e.firstSeenAt).slice(-4)})`);
  }
}

main();
