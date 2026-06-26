# 完善历史树（Link Creation Tree）— 设计文档

- **日期**: 2026-06-26
- **状态**: Draft（待用户审阅）
- **范围**: ob-ps / Local Runner Obsidian 插件
- **关联模块**: `src/wikilink-inspector/`、`src/view/merged-view.ts`、`main.ts`

---

## 1. 背景与问题

当前「完善」按钮会调用外部 Claude CLI 进程（`claude -p /obsidian-repair-unresolved-links`）扫描 vault 内未解析的 `[[ ]]` 双链，自动补全或创建缺失笔记。但完善执行后，用户**无法回溯**：

- 这次完善到底创建了哪些笔记？
- 每个新笔记是被哪篇源笔记、哪一行、哪条 `[[]]` 触发创建的？
- 多次完善累积下来的笔记之间有没有「A 触发 B、B 触发 C」的链式关系？
- 整体补全进度如何（还剩多少未解析）？

用户希望：每次完善都**记录创建双链的父级文本位置**，组织成**树状结构**（无父级则为根节点），在侧边栏渲染树状图，支持**快速跳转到创建位置** + **进度掌握**。

---

## 2. 两个关键事实（决定设计走向）

读代码后确认的两点，直接重塑了数据建模：

### 事实 1：插件本身不创建笔记

完善点击链路：`merged-view.ts:430 onRepairBtnClick` → 确认弹窗 → `main.ts:183 onRepairUnresolvedLinks` → `view.startOrCreateTab` → `spawn` 外部 Claude 进程。**真正的笔记创建发生在另一个进程里，插件代码没有「笔记被创建」的回调点。**

> 推论：不能在「完善按钮」里直接记录创建位置。只能靠**完善前后的状态差异**反推。

### 事实 2：树所需的全部数据，vault 里已经有了

Obsidian 的 `metadataCache` 通过现有 `collectRows()`（`link-collector.ts`）已经给出完整链接图：每条 `[[X]]` 的 `sourcePath + position + target + state`。**树本质上是这个链接图的一个投影**，不是一份需要新建并独立维护的数据。

> 推论：不要建一棵「要长期维护的可变树」——那是在和 Obsidian 抢着管同一份事实，会腐化。要存的是「不可派生的增量」，派生量交给运行时算。

---

## 3. 目标与非目标

### 目标

1. 每次完善创建的笔记被记录，含触发它的源笔记路径 + 行列位置
2. 多次完善的记录组织成树（根 = 触发源不是完善产物的笔记；叶 = 触发源也是完善产物）
3. 侧边栏渲染树状图，点击节点跳转到「创建位置」（源笔记里那条 `[[]]` 所在行）
4. 展示补全进度（已完成 / 剩余未解析）
5. 重命名 / 删除笔记后树自动跟随，不腐化
6. 复用现有架构（纯函数逻辑 + 注入 source + 分离渲染），不引入新范式

### 非目标（本期不做，留待 v2）

- 完善运行中的实时进度（本期为批次语义，进程退出后一次性落库）
- 手动新建笔记也纳入树（本期只记录完善触发）
- 树节点的拖拽重排 / 编辑
- 跨 vault 迁移

---

## 4. 核心设计：Event Sourcing + 派生投影

把问题拆成两件正交的事：

| 层 | 职责 | 模式 |
|---|---|---|
| **记录层** | 只存「不可派生的增量」——完善批次引入的创建事件 | Event Sourcing / Append-only Log |
| **投影层** | 运行时把事件日志 + 当前链接图 → 树 | Projection / View Model |

### 4.1 存储：只存事件原子，不存树

```ts
// src/link-tree/creation-event.ts

/** 一条「完善创建」事件 —— append-only，不可变 */
interface CreationEvent {
  id: string;                                // 稳定 id（防重 / DOM key）
  target: string;                            // 被创建的笔记名（link 文本，如 "B"）
  sourcePath: string;                        // 触发它的【主】源笔记路径（如 "A.md"）
  position: { line: number; col: number };   // 源笔记里那条 [[target]] 的位置（跳转锚点）
  createdAt: number;                         // 这次完善批次的完成时间
  runId: string;                             // 关联到哪次完善进程（按批分组 / 撤销整批用）
}
```

**就这些字段。** 没有 `parent`、没有 `children`、没有 `isRoot` —— 那些是派生量。

**主源（primary source）选择**：一个 target 可能被多个源笔记的 `[[X]]` 同时指向。事件只存**主源**——diff 时在所有触发源里取 `sourceCtime` 最大者（与现有 `sortRowsByCtimeDesc` 排序约定一致）。其余源在渲染时从当前 `LinkRow[]` 现算（历史不可派生的只有「这次完善创建了它 + 主源位置」，其余都能从活数据还原）。

### 4.2 持久化位置

扩展 `main.ts` 的 `PluginData`（沿用现有 `saveData` 机制）：

```ts
interface PluginData {
  processes: ProcessConfig[];
  settings?: PluginSettings;
  linkTree?: { events: CreationEvent[]; version: number };   // ← 新增字段
}
```

- `version` 留作后续 schema 迁移
- `keepDataOnUninstall` 备份链路（`backup/data-backup.ts`）需同步纳入 `linkTree`，保证卸载恢复时不丢

### 4.3 root / leaf：存储层无区别，投影层区分

> **关键结论：没有 `createRoot()` 和 `addLeaf()` 两个函数。落库永远只有一条路径：`repo.append(event)`。root/leaf 由 `projectTree()` 运行时算出。**

**判定规则（纯派生）**：

```
对事件 R = { target, sourcePath }:
   parentKey = normalize( basename(sourcePath) )      // "folder/B.md" → "B"
   在「所有事件的 target 集合」里找 parentKey:
      命中 → R 是「叶子」（父 = target 命中的那个事件）
      未命中 → R 是「根」（触发它的源笔记是原生用户笔记，非完善产物）
```

即：**根 = 触发源本身不是完善创建的**；叶子 = 触发源也是完善创建的。两者都带 `sourcePath`/`position`——根节点把它当作「跳转锚点 / breadcrumb 上下文」，叶子节点既当跳转锚点、又参与父子挂接。

**`normalize` 规则**（与现有 `sourceBaseName` / `extractBracketedText` 语义对齐）：
- `basename`：取路径最后一段，去 `.md` 后缀
- `target`：剥离 `#anchor`（metadataCache 的 `link.link` 不含 alias，alias 在 `displayText`）

**运行时投影模型**（不存储）：

```ts
// src/link-tree/tree-projector.ts

interface TreeNode {
  event: CreationEvent;        // 对应事件（含 target, sourcePath, position, createdAt）
  children: TreeNode[];        // 派生：挂在此节点下的子事件
  isStale: boolean;            // 派生：当前链接图里 target 已不存在（笔记被删）→ 灰显
  refs: LinkRow[];             // 派生：当前指向 target 的所有源（查看全部引用）
  depth: number;               // 派生：渲染缩进 / 折叠默认深度
}

/** 纯函数：事件日志 + 当前链接图 → 树（返回根节点数组，递归含子节点） */
function projectTree(events: CreationEvent[], rows: LinkRow[]): TreeNode[];
```

**`projectTree` 算法**（复杂度 **O(R + E)**，R=rows 数，E=events 数，无嵌套循环）：

```
0. 预索引 rows（关键优化，杜绝 O(E×R)）:
     byTarget: Map<normTarget, LinkRow[]>   // O(R) 一次建好, normalize 只算一次
1. 建事件索引 index: Map<normTarget, event>
     遍历 events，按 normalized(target) 入索引；同 target 多事件取最新 createdAt   // O(E)
2. 对每个 event 分类:
     parentKey = normalize(basename(event.sourcePath))
     parentEvent = index.get(parentKey)
     若 parentEvent 存在且非自身 → event 挂为 parentEvent 的 child（叶）
     否则 → event 为 root
3. 修饰每个 node（O(1) 查表，不遍历 rows）:
     refs    = byTarget.get(normalize(node.event.target)) ?? []
     isStale = refs.length === 0        // 当前链接图已无该 target → 笔记被删 → 灰显
     depth   = 递归层数
4. 返回 roots（按 createdAt 降序），递归 children（按 createdAt 降序）
```

**复用约定**：投影**不自己扫 vault**，而是复用视图已算好的 `this.rows`（见 §8 接入点）。编辑热路径的 O(vault) 扫描是现有 `refreshWli` 的既有成本，本设计零额外扫描。

### 4.4 派生设计「白送」的两个维护能力

对比可变树方案，这两个原本最头疼的边界，这里直接消失：

1. **晚到的父节点自动重挂**
   先 append `R_C{tgt:C, src:B.md}`（此时 B 尚未建 → C 暂为根），后 append `R_B{tgt:B, src:A.md}`（B 建了）→ 重跑 `projectTree`，C 自动从根变成 B 的子节点。**无需任何 fixup 代码。**
2. **重命名 / 删除自动跟随**
   源笔记重命名或删除 → 当前 `rows` 是 Obsidian 维护的最新数据 → 投影里 `refs` / `isStale` 自动更新。**永不腐化，因为从不缓存派生结果。**

---

## 5. 检测机制：批次边界（snapshot diff）

采用**批次边界**语义（而非实时 `resolved` 事件）：每次完善 = 一批新节点，进程退出后一次性落库。

```
完善启动前:  S_before = collectUnresolvedEdits(makeUnresolvedSource(app))
                 → { target → { sourcePath, position, sourceCtime } } 快照
完善进程退出:  S_after  = collectUnresolvedEdits(makeUnresolvedSource(app))
              created  = S_before.targets  −  S_after.targets
                          (从不解析 → 已解析 = 这次完善新建/补全的笔记)
              对每个 target:
                 primarySource = S_before[target] 里 sourceCtime 最大的源
                 → CreationEvent { target, sourcePath, position, createdAt: now, runId }
              repo.appendAll(events)
```

**为什么选批次而非实时**：
- 语义干净——每次完善 = 一批，`runId` 可分组、可整批撤销
- 落库无歧义——只记完善产物，手动新建笔记不会混入
- 实现最薄——复用现成 `collectUnresolvedEdits`

**代价**（接受）：完善运行中树不实时更新，进程退出后才落库。实时进度留待 v2（叠加 `metadataCache.on("resolved")` 事件做运行中预览，不落库）。

---

## 6. 连续流程图

### 图 A — 检测 → 落库 → 渲染（运行时主链路）

```
[用户点「完善」]
        │
        ▼
view.onRepairBtnClick → WliRepairConfirmModal 确认
        │
        ▼
main.onRepairUnresolvedLinks → view.startOrCreateTab(...)
        │
        ├─① tracker.beforeRun()
        │      source  = makeUnresolvedSource(app)        ◄── 复用 clear-unresolved.ts:33
        │      edits   = collectUnresolvedEdits(source)    ◄── 复用 clear-unresolved.ts:79
        │      S_before = { target → {sourcePath, position, sourceCtime} }
        │
        ▼
spawn `claude -p /obsidian-repair-unresolved-links`   (外部进程, 真正创建/补全笔记)
        │
        │  运行中：日志流入「终端输出」zone；树【暂不更新】(批次语义)
        ▼
进程退出 → view.onProcChange(tabId, "exit")
        │
        ├─② tracker.afterRun(S_before)   ─── diff ──────────────────────┐
        │      S_after  = collectUnresolvedEdits(source)                 │
        │      created  = S_before.targets  −  S_after.targets           │ (从不解析→已解析=新建)
        │      对每个 target:                                               │
        │         primarySource = S_before[target] 里 sourceCtime 最大源    │
        │         → 构造 CreationEvent(target, sourcePath, position)       │
        │      repo.appendAll(events)                                       │
        │      → 写回 PluginData.linkTree (saveData)                        │
        ├─────────────────────────────────────────────────────────────────┘
        ▼
③ projectTree(repo.events, currentRows)  ──► TreeNode[]  (实时算根/叶, 实时跟链接图)
        │
        ▼
④ render 树 →「双链检查」zone 顶部新增可折叠子区「完善历史」
        │
[用户点节点] → openSource({ sourcePath: node.event.sourcePath,
                            position:  node.event.position })   ◄── 复用 merged-view.ts:790
              → openFile + setCursor(line,col) + scrollIntoView
```

### 图 B — projectTree 内部（root/leaf 分类，纯函数）

```
输入: events = [ R_B{tgt:B,src:A.md}, R_C{tgt:C,src:B.md}, R_D{tgt:D,src:X.md} ]
      rows   = currentRows

① 建索引  index = { B:R_B, C:R_C, D:R_D }       // normalizedTarget → event (重名取最新)

② 分类每个 event:
   R_B: parentKey=basename("A.md")="A";  "A"∈index? ✗ → ROOT
   R_C: parentKey=basename("B.md")="B";  "B"∈index? ✓(R_B) → 挂为 R_B 的 child (叶)
   R_D: parentKey=basename("X.md")="X";  "X"∈index? ✗ → ROOT

③ 修饰:
   node.isStale = rows 里无 row.target 命中 node.event.target   (笔记被删 → 灰显)
   node.refs    = rows.filter(r => norm(r.target) === norm(node.event.target))

④ 返回 roots (按 createdAt 降序), 递归 children

结果树:
   ROOT  B  (src=A.md · line 12 · 原生笔记 A 触发)        ┐
         └─ C  (src=B.md · line 5 · 叶子)                 │  ← 全部派生, 不落库
   ROOT  D  (src=X.md · line 3)                           ┘
```

---

## 7. 渲染与交互

### 7.1 放置位置

现有侧边栏三分区：操作区(30%) / 双链检查(35%) / 终端输出(35%)。树归入**「双链检查」zone**，在其顶部新增一个**可折叠子区**「完善历史」：

```
┌─ 双链检查 ────────────────────────────┐
│  ▸ 完善历史  (共 N 篇 · 剩 M 未解析)    │  ← 新增, 默认折叠
│    └─ 展开后: 树状节点列表               │
│  ───────────────────────────           │
│  已解析 (5)  …                          │  ← 现有
│  未解析 (3)  …                          │  ← 现有
└────────────────────────────────────────┘
```

- 节点样式复用 `wli-row` / `wli-dot` 体系（`inspector-render.ts`），按状态着色
- 缩进表达层级；`isStale` 节点灰显 + 删除线
- 顶部一行进度文字：`共 N 篇 · 最近 X 分钟前 · 剩 M 未解析`（M 来自现有未解析 rows 计数）

### 7.2 跳转

点击节点 → 构造伪 `LinkRow` 喂给**现有** `openSource()`（`merged-view.ts:790`，已实现 `openFile + setCursor + scrollIntoView`）：

```ts
openSource({
  sourcePath: node.event.sourcePath,
  position: node.event.position,
} as LinkRow);
```

零新增跳转逻辑。

---

## 8. 模块布局

对齐 `src/wikilink-inspector/` 的目录风格（类型 / 纯函数 / 渲染 / 测试 分离）：

```
src/link-tree/
├── creation-event.ts          // CreationEvent 类型 + normalize()
├── creation-tracker.ts        // beforeRun()/afterRun() diff（注入 source，可测）
├── tree-projector.ts          // projectTree() 纯函数
├── link-tree-repository.ts    // load/save 到 PluginData.linkTree
├── tree-render.ts             // DOM 渲染（对标 inspector-render.ts）
├── tree-projector.test.ts     // projectTree 单测（根/叶/重挂/失效）
└── creation-tracker.test.ts   // diff 单测（注入假 source）
```

### 接入点（改动现有文件）

| 文件 | 改动 |
|---|---|
| `main.ts` | `PluginData` 加 `linkTree` 字段；`onload` 读 / `saveSettings` 写；构造 view 时注入 tracker + repo |
| `src/view/merged-view.ts` | 完善启动前调 `tracker.beforeRun()`；`onProcChange` exit 分支调 `tracker.afterRun()` → 落库 → 重渲染树；`refreshWli()` 里 `this.rows` 赋值后调用 `renderTreeAll()`（**复用 `this.rows`，不二次扫 vault**）；`buildWliSection()` 增「完善历史」子区 |
| `src/backup/data-backup.ts` | `BackupPayload` 纳入 `linkTree` |

---

## 9. 复用盘点

| 新逻辑 | 复用的现成件 | 位置 |
|---|---|---|
| ① 快照源 | `makeUnresolvedSource(app)` | `clear-unresolved.ts:33` |
| ① 收集未解析（含位置） | `collectUnresolvedEdits(source)` | `clear-unresolved.ts:79` |
| ④ 跳转 | `openSource(row)` | `merged-view.ts:790` |
| 链接行数据 | `LinkRow` / `collectRows` / `partitionByState` | `link-collector.ts` / `link-row.ts` |
| 纯函数风格 | 逻辑纯函数 + 注入 source + 分离 DOM 渲染 | 全模块既有约定 |

---

## 10. 边界与错误处理

| 场景 | 处理 |
|---|---|
| 完善进程异常退出（非 0） | 仍执行 `afterRun` diff——只要 Obsidian 索引已更新，部分创建也会被捕获；无创建则 `created` 为空，不落库 |
| 同一 target 被多次完善创建（删了又补） | 事件 append-only，会产生多条同 target 事件；投影以最新 createdAt 为主节点参与树，旧事件保留在日志里但不单独展示（「该 target 历史创建记录」折叠视图留待 v2） |
| 触发源笔记被删除 | 投影 `isStale` = true → 灰显；不影响其余树结构 |
| 中间节点被删除 | 派生：其子节点的 `parentKey` 不再命中索引 → 自动提升为根（无需孤儿处理代码） |
| 完善运行中被再次点击完善 | 复用现有「running 先 stop 同名 tab 再 start」逻辑（`main.ts:213`）；`beforeRun` 以最新一次启动的快照为准 |
| 外部进程未更新 Obsidian 索引就退出 | diff 结果为空（`S_before == S_after`）→ 不落库，不报错；可在 Notice 提示「未检测到新建笔记」 |
| `linkTree` schema 变更 | `version` 字段 + 迁移函数（类比现有 `migrateCommandGroups`） |

---

## 11. 测试策略

沿用项目现有 vitest + 纯函数注入的风格：

- **`tree-projector.test.ts`**
  - 单根、单链 A→B→C、多根、森林
  - 晚到父节点：先 append 子再 append 父 → 自动重挂
  - 中间节点删除 → 子提升为根
  - `isStale` 判定（target 不在 rows）
  - `refs` 聚合
  - 同 target 多事件取最新
- **`creation-tracker.test.ts`**
  - 注入假 `CollectorSourceLite`：before/after 两个状态 → diff 出正确 created 集合
  - 主源选择（多源取 ctime 最大）
  - 空创建 / 全创建 / 部分创建
- **`link-tree-repository.test.ts`**
  - append 后 load 一致；空 data 首次 load 返回空

DOM 渲染（`tree-render.ts`）走人工/视觉验证，不强求单测（与现有 `inspector-render.ts` 一致）。

---

## 12. 决策点（已选默认，可推翻）

> 以下为本设计采用的默认选择。审阅时若不认可，指出即可调整。

| # | 决策点 | 采用 | 理由 | 备选 |
|---|---|---|---|---|
| D1 | 存储结构 | 只存 `CreationEvent`（5 字段 + runId），树结构零存储 | 避免与 metadataCache 重复事实、防腐化 | 可变 TreeNode 指针结构（否决：腐化 + 维护复杂） |
| D2 | root/leaf 落库 | 无独立路径，全靠 `projectTree` 派生 | append 单一路径，晚到父节点自动重挂 | 存储 parent 指针（否决） |
| D3 | 根节点显示 | **变体 A**：根 = 被创建笔记；触发它的原生源笔记作为上下文/breadcrumb 显示，不作为独立树节点 | 树只含完善产物，边界清晰 | 变体 B：把原生源笔记也画作根节点（混合原生+产物，更"自然"但树边界模糊） |
| D4 | 检测时机 | 批次边界（进程退出后一次性落库） | 语义干净、与「完善」动作一一对应 | 实时 `resolved` 事件（留 v2） |
| D5 | 持久化位置 | `PluginData.linkTree`（扩展现有 saveData） | 一致性 > 隔离性 | 独立 JSON 文件 |

---

## 13. 性能分析与优化

### 13.1 成本模型（按路径）

| 路径 | 触发 | 现有成本 | 本设计增量 | 结论 |
|---|---|---|---|---|
| **编辑/刷新（热）** | 每次笔记编辑（经 400ms 防抖，`metadataCache.on("changed")`） | `refreshWli` 全 vault 扫描 O(files × links) | 投影 O(R+E)，**复用 `this.rows`，零额外扫描** | 可忽略，不恶化热路径 |
| **完善批次（冷）** | 用户点完善 | —— | `beforeRun` + `afterRun` 各一次全扫描 | 可接受（≈ 一次「清除全部」，百毫秒级，用户刚等完 Claude 运行无感） |
| **持久化** | 仅完善批次结束 | —— | `saveData` 写整个 data.json 一次 | 非热路径 |

> **核心 reassure**：编辑热路径的 O(vault) 扫描是 `refreshWli` 的**既有成本**，本设计只是在其后追加 O(R+E) 投影，并复用已算好的 `this.rows`，不引入第二次 vault 扫描。

### 13.2 已内建的优化（实现时必须做）

1. **预索引 rows**：投影先用 O(R) 建 `Map<normTarget, LinkRow[]>`，每个节点的 `refs`/`isStale` 退化为 O(1) 查表——杜绝朴素的 O(E×R) 嵌套循环。整投影 O(R+E)。
2. **normalize 只算一次**：建索引时给每行/每事件预算并缓存 `normTarget`，避免热循环里重复 `split`/`replace`。
3. **afterRun 第二次扫描保留**：进程退出那一刻 `this.rows` 不保证已反映新建笔记（Obsidian 异步重索引，缓存可能未 settle），故 afterRun 跑一次权威 `collectUnresolvedEdits` 最稳；成本可接受，不值得为省它引入时序脆弱性（监听 resolved 防抖复用 rows）。
4. **渲染默认折叠 + 只渲染可见子树**：复用现有 `collapsed`/chevron 与 `DEFAULT_PREVIEW=5` 预览+展开模式，树大时不一次性建出几千 DOM 节点。

### 13.3 可选优化（MVP 不做，大 vault profile 后再上）

- **结构投影 memoize**：树骨架（parent/child）只依赖 events（仅完善批次变）；可缓存结构，刷新时只重算 `refs`/`isStale`（O(E)）。MVP 全量重算已是 O(R+E)，量级小，先不做。
- **events 上限（安全阀）**：事件 append-only 无限增长；可加可配置上限（如最近 1000 条 / 最近 90 天）滚动淘汰，防 data.json 膨胀与投影变慢。低概率但便宜。

---

## 14. 未来工作（v2，本期不做）

- 完善运行中实时进度预览（`metadataCache.on("resolved")`，不落库）
- 手动新建笔记也纳入树（需区分来源）
- 整批撤销（按 `runId` 删除某次完善的所有事件）
- 同 target 多次创建的「历史记录」折叠视图（展示「曾被创建 N 次」）
- 树节点搜索 / 筛选（复用 `WikilinkInspectorModal` 的搜索模式）
- 导出树为 Markdown / Canvas

---

## 附：术语表

| 术语 | 含义 |
|---|---|
| 完善 | 「完善」按钮触发的、由外部 Claude 进程执行的未解析双链补全/创建动作 |
| 创建事件 (CreationEvent) | 一次完善批次中、某个 target 从未解析→已解析的不可变记录 |
| 主源 (primary source) | 触发某 target 创建的多个源笔记中，`sourceCtime` 最大的那个 |
| 投影 (projection) | 由事件日志 + 当前链接图实时计算出的树，不落库 |
| 根 (root) | 触发源不是完善产物的创建事件 |
| 叶 (leaf) | 触发源也是完善产物的创建事件 |
| `isStale` | 投影时发现 target 在当前链接图已不存在（笔记被删） |
