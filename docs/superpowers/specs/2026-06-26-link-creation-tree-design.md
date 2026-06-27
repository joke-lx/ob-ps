# 完善历史树（Link Creation Tree）— 设计文档

- **日期**: 2026-06-26
- **状态**: Draft v4（+ 作用域过滤 + 极简交互，待用户审阅）
- **范围**: ob-ps / Local Runner Obsidian 插件
- **关联模块**: `src/wikilink-inspector/`、`src/view/merged-view.ts`、`main.ts`

> **v2 变更**（相对 v1）：检测改为 **capture 模型**（点击时捕获未解析双链，状态实时派生，**无 afterRun / 无 diff**）；渲染改为 **HTML5 `<canvas>` 交互画布**（pan / zoom / click，适配 100+ 节点）；存储与文件结构按设计模式敲定。
>
> **v3 变更**：投影优化为 **O(E)**——status/isStale 走 Obsidian `getFirstLinkpathDest`/`getAbstractFileByPath` 的 O(1) 查询（注入 `ProjectDeps` 保持可测），不再扫 `this.rows`；`refs` 延迟到按需。capture 复用修正为 `collectRows`（带 ctime，能选主源）。
>
> **v4 变更**：交互极简化——**移除顶部 toolbar**，节点右侧 +/− 图标折叠子树、点击节点直接跳转（无详情弹窗）、双击复位；树**按当前笔记的顶层文件夹作用域过滤**（概率论下不显示内存树）。

---

## 1. 背景与问题

「完善」按钮调用外部 Claude CLI（`claude -p /obsidian-repair-unresolved-links`）扫描 vault 内未解析 `[[ ]]` 双链，自动补全/创建缺失笔记。但完善执行后用户**无法回溯**：

- 这次完善要处理 / 已处理哪些未解析双链？
- 每个被处理的双链，其父级文本位置（源笔记、哪一行）在哪？
- 多次完善累积下来的笔记之间有没有「A→B→C」链式关系？
- 整体补全进度如何（已创建 / 待处理）？

用户希望：每次完善都**记录未解析双链的父级文本位置**，组织成**树状结构**（无父级则为根节点），在侧边栏以**可拖动/缩放/点击的画布**渲染，支持**快速跳转到创建位置** + **进度掌握**。

---

## 2. 两个关键事实（决定设计走向）

### 事实 1：插件本身不创建笔记

完善链路：`merged-view.ts:430 onRepairBtnClick` → 确认弹窗 → `main.ts:183 onRepairUnresolvedLinks` → `view.startOrCreateTab` → `spawn` 外部 Claude 进程。**笔记创建发生在另一个进程，插件无「笔记被创建」回调。**

> **推论**：既然无法挂钩「创建」事件，就挂钩「输入」——在**点击完善那一刻**捕获当前所有未解析双链（这是完善将要处理的输入），至于是否已创建，**实时从 Obsidian 索引派生**。这正是 capture 模型的动机。

### 事实 2：树所需的链接关系，Obsidian 已索引

`metadataCache` 通过现有 `collectRows()`（`link-collector.ts`）给出完整链接图：每条 `[[X]]` 的 `sourcePath + position + target + state`。且 `metadataCache`/`vault` 内部维护 **path→TFile** 与**链接解析**的哈希索引，可 O(1) 查询。

> **推论**：存「不可派生的增量」（捕获事件），派生量（树结构 / 状态 / 坐标）交给运行时算，**绝不入库、绝不重扫**——直接查 Obsidian 已建好的索引。

---

## 3. 目标与非目标

### 目标

1. 点击完善时，捕获当前所有未解析双链，含其父级源笔记路径 + 行列位置
2. 多次捕获累积成树（根 = 触发源不是捕获目标；叶 = 触发源也是捕获目标）
3. 侧边栏以 **canvas 画布**渲染树，支持拖动平移 / 滚轮缩放 / 点击节点跳转到「创建位置」
4. 展示补全进度（已创建 / 待处理）
5. 重命名 / 删除笔记后树自动跟随，不腐化
6. 适配 **100+ 节点**（canvas 性能）
7. 复用现有架构（纯函数 + 注入依赖 + 分离渲染），不引入新范式、不引重依赖

### 非目标（本期不做，留待 v2）

- 完善运行中的实时进度预览（本期 capture 在点击时一次性完成，状态靠现有 `refreshWli` 刷新派生）
- 手动新建笔记也纳入树
- 画布节点拖拽重排 / 手动编辑布局
- 跨 vault 迁移

---

## 4. 核心设计：Event Sourcing + 派生投影

| 层 | 职责 | 模式 |
|---|---|---|
| **记录层** | 只存「不可派生的增量」——完善点击时捕获的未解析双链事件 | Event Sourcing / Append-only Log |
| **投影层** | 运行时把事件日志 + Obsidian 索引 → 树 + 状态 + 坐标 | Projection / View Model |

### 4.1 存储：append-only 事件原子（详见 §10）

```ts
// src/link-tree/creation-event.ts

/** 一条「完善捕获」事件 —— append-only、不可变、不含派生状态 */
interface CreationEvent {
  id: string;                              // 稳定 id（DOM key / 防重）
  target: string;                          // 未解析双链的目标笔记名（link 文本，如 "B"）
  sourcePath: string;                      // 主源笔记路径（触发捕获的 [[]] 所在文件，如 "A.md"）
  position: { line: number; col: number }; // 该 [[]] 在源笔记里的位置（跳转锚点）
  firstSeenAt: number;                     // 首次在完善点击时捕获的时间
  runId: string;                           // 哪次完善点击（按批分组 / 筛选用）
}

/** 持久化：PluginData.linkTree（唯一存储） */
interface LinkTreeStore {
  events: CreationEvent[];   // append-only 日志
  version: number;           // schema 版本（迁移用）
}
```

**主源选择**：一个 target 可能被多个源笔记的 `[[X]]` 同时指向。事件只存**主源**——捕获时在该 target 的所有源里取 `sourceCtime` 最大者（与现有 `sortRowsByCtimeDesc` 一致）。其余源在渲染时从当前 `LinkRow[]` 现算（延迟 `refs`）。

### 4.2 持久化位置

扩展 `main.ts` 的 `PluginData`（沿用现有 `saveData`）：

```ts
interface PluginData {
  processes: ProcessConfig[];
  settings?: PluginSettings;
  linkTree?: { events: CreationEvent[]; version: number };   // ← 新增字段
}
```

- `keepDataOnUninstall` 备份链路（`backup/data-backup.ts`）需同步纳入 `linkTree`
- `version` 留作 schema 迁移（类比 `migrateCommandGroups`）

### 4.3 root / leaf：存储层无区别，投影层区分

> **关键结论：没有 `createRoot()` 和 `addLeaf()` 两个函数。落库永远只有一条路径：`repo.appendAll(events)`。root/leaf 由 `projectTree()` 运行时算出。**

**判定规则（纯派生）**：

```
对事件 R = { target, sourcePath }:
   parentKey = normalize( basename(sourcePath) )      // "folder/B.md" → "B"
   在「所有事件的 target 集合」里找 parentKey:
      命中 → R 是「叶子」（父 = target 命中的那个事件）
      未命中 → R 是「根」（触发源是原生用户笔记，非捕获目标）
```

**normalize 规则**（与现有 `sourceBaseName` / `extractBracketedText` 对齐）：
- `basename`：路径最后一段去 `.md`
- `target`：剥离 `#anchor`（`link.link` 不含 alias）

**运行时投影模型**（不存储）：

```ts
// src/link-tree/tree-projector.ts

interface TreeNode {
  event: CreationEvent;
  children: TreeNode[];          // 派生（事件自身匹配, 不查 rows）
  status: 'created' | 'pending'; // 派生：Obsidian O(1) 查询 target 是否已解析
  isStale: boolean;              // 派生：Obsidian O(1) 查询源笔记是否还在
  refs?: LinkRow[];              // 延迟派生：仅"查看引用"时算, 不在投影热路径
  depth: number;                 // 派生
}

/** 投影依赖：注入 Obsidian 的 O(1) 查询，保持纯函数可测（仿 makeUnresolvedSource 模式） */
interface ProjectDeps {
  isResolved: (target: string, sourcePath: string) => boolean;  // ← getFirstLinkpathDest
  sourceExists: (sourcePath: string) => boolean;                // ← getAbstractFileByPath
}

/** 纯函数：事件日志 → 树。O(E)，与 vault 链接总数 R 无关 */
function projectTree(events: CreationEvent[], deps: ProjectDeps): TreeNode[];
```

**`projectTree` 算法**（复杂度 **O(E)**，E=events，与 vault 链接数 R 无关）：

```
0. 建事件索引 byTarget: Map<normTarget, event>   // O(E), 同 target 多事件取最新 firstSeenAt
1. 对每个 event 分类（事件自身匹配, 不碰 rows）:
     parent = byTarget.get(normalize(basename(event.sourcePath)))   // O(1)
     parent 存在且非自身 → 挂为 child（叶）; 否则 → root
2. 修饰每个 node（Obsidian O(1) 查询, 不碰 rows）:
     status  = deps.isResolved(event.target, event.sourcePath) ? 'created' : 'pending'
     isStale = !deps.sourceExists(event.sourcePath)
     depth   = 递归层数
     refs    = 不算（延迟到"查看引用"时, 走单独 O(R) 反链查询）
3. 返回 roots（按 firstSeenAt 降序），递归 children（按 firstSeenAt 降序）
```

**为何 O(E)**：status/isStale 走 Obsidian 已建好的哈希索引（`getFirstLinkpathDest` 的链接解析缓存、`getAbstractFileByPath` 的路径表），都是 O(1)；parent/children 靠事件自身的 target↔basename 匹配，也是 O(E)。唯一需要全局链接图的 `refs`（反链）被踢出热路径、按需计算。**原理：查索引而非扫集合**——Obsidian 为支持双链跳转本就持续维护这些索引，我们复用它已付过代价的索引，不自己重扫一份 rows 副本重新推导（单一事实来源）。

**复用约定**：投影**不扫 vault、不依赖 `this.rows`**——status/isStale 走 Obsidian O(1) 查询，parent/children 走事件索引。`this.rows` 仅用于延迟的 refs。编辑热路径的 O(R) 扫描是 `refreshWli` 既有成本，本设计新增仅 O(E)（<1ms）。

### 4.4 派生设计「白送」的两个维护能力

1. **晚到的父节点自动重挂**：先 append 子（暂为根）后 append 父 → 重跑 `projectTree` 自动重挂。**无需 fixup。**
2. **重命名 / 删除自动跟随**：Obsidian 索引持续更新 → `status`/`isStale` 自动反映最新。**永不腐化。**

---

## 5. 检测机制：capture 模型（无 diff）

> **模型 B**：点击完善时，扫描当前所有未解析双链，按 target 去重后 append 新事件。**无 beforeRun/afterRun 配对，无 diff，无第二次全 vault 扫描。** `created/pending` 状态由现有 `refreshWli`（`metadataCache` 变化触发）调投影实时派生。

### 捕获流程

```
点击完善 → modal 确认
   │
   ▼
main.onRepairUnresolvedLinks（spawn 之前）
   ├─ tracker.capture(makeSource(app))
   │     rows = collectRows(source)                    ◄── 复用 link-collector.ts（CollectorSource 带 ctime）
   │     未解析 = rows.filter(r => r.state === 'unresolved')
   │     按 target 聚合；对每个「日志里没有的新 target」:
   │        primarySource = 该 target 多源里 sourceCtime 最大者   // ctime 来自 CollectorSource
   │        → CreationEvent { target, sourcePath, position, firstSeenAt: now, runId }
   │     repo.appendAll(newEvents) → saveData(PluginData.linkTree)
   │
   ▼
spawn claude -p repair skill  （外部进程真正创建/补全笔记）
   │  运行中：日志流入「终端输出」zone
   ▼
笔记被创建 → metadataCache 更新 → 现有 refreshWli（400ms 防抖）自动触发
   → projectTree 重算 → status 从 pending 翻成 created → canvas 重绘
```

**去重**：以 `normalize(target)` 为去重键。已在日志里的 target 跳过（同一 `[[X]]` 多次点击只记一次）。多源同一 target：事件只存主源，其余源进延迟 `refs`。

**为什么 capture 而非 diff**：
- 更简单——砍掉 afterRun + diff + 第二次扫描，消除「进程退出时缓存未 settle」的时序风险
- 状态全靠现有 `refreshWli` 实时派生，无需额外触发
- 进度更完整——可见 pending + created
- 跳转位置在捕获时即得，不依赖 diff

**代价**（接受）：日志含「点击时未解析但最终未创建」的 pending 条目（这正是进度视图需要的信息）；需按 target 去重防膨胀。

---

## 6. 连续流程图

### 图 A — 捕获 → 派生 → 画布（运行时主链路）

```
[用户点完善] → modal 确认
        │
        ▼
main.onRepairUnresolvedLinks
        ├─① tracker.capture(makeSource(app))
        │      rows = collectRows(source)   ◄── 复用 link-collector（带 ctime）, 过滤 unresolved
        │      对每个新 target（按 target 去重，已在日志的跳过）:
        │         primarySource = 多源里 sourceCtime 最大者
        │         → CreationEvent{target, sourcePath, position, firstSeenAt, runId}
        │      repo.appendAll(newEvents) → saveData(PluginData.linkTree)
        │
        ▼
spawn `claude -p /obsidian-repair-unresolved-links`   (外部进程, 真正创建笔记)
        │
        │  运行中：日志流入「终端输出」zone
        ▼
笔记被创建 → metadataCache 更新 → 现有 refreshWli（400ms 防抖）
        │
        ├─② this.rows = collectRows(...)              ◄── 既有全扫描（WLI 列表用, 非本设计新增）
        ├─③ projectTree(repo.events, projectDeps)     ◄── O(E), Obsidian O(1) 查询, 不依赖 ②
        ├─④ layoutTree(roots) → 节点坐标 + bounds
        └─⑤ canvas.update() → 重绘（视口剔除）

[用户点节点]  → hit-tester → openSource(sourcePath, position) → 跳转      ◄── 复用 merged-view.ts:790
[拖动/滚轮]   → input-controller 改 viewport → canvas 重绘（仅 transform, RAF 批处理）
```

### 图 B — projectTree 内部（root/leaf 分类，纯函数）

```
输入: events = [ R_B{tgt:B,src:A.md}, R_C{tgt:C,src:B.md}, R_D{tgt:D,src:X.md} ]
      deps  = makeProjectDeps(app)   // isResolved / sourceExists → Obsidian O(1)

① 建事件索引  byTarget = { B:R_B, C:R_C, D:R_D }       // normTarget → event (重名取最新)

② 分类每个 event（事件自身匹配）:
   R_B: parentKey=basename("A.md")="A";  "A"∈byTarget? ✗ → ROOT
   R_C: parentKey=basename("B.md")="B";  "B"∈byTarget? ✓(R_B) → 挂为 R_B 的 child (叶)
   R_D: parentKey=basename("X.md")="X";  "X"∈byTarget? ✗ → ROOT

③ 修饰（Obsidian O(1) 查询, 不碰 rows）:
   status  = deps.isResolved(target, sourcePath) ? 'created' : 'pending'
   isStale = !deps.sourceExists(sourcePath)

结果树:
   ROOT  B  (src=A.md·line12 · status:created ✓)     ┐
         └─ C (src=B.md·line5  · status:pending ⏳)  │  ← 全部派生, 不落库
   ROOT  D  (src=X.md·line3  · status:created ✓)     ┘
```

---

## 7. 渲染与交互：HTML5 Canvas 画布

### 7.1 为何 canvas（非 SVG）

节点量预期 **100+**。SVG 是 DOM，每个节点一个元素，100–数百节点 + 频繁 pan/zoom 会拖慢（DOM 开销、事件绑定多）。**HTML5 `<canvas>` 2D 上下文**：单元素、命令式绘制、pan/zoom 只改 transform 后全量重绘，性能稳定，适配数百节点。代价：点击需手写命中检测、文字手绘——成本可控（见下）。

### 7.2 架构（MVC + 纯函数）

```
Model（数据）          Controller（交互）            View（渲染）
──────────────        ─────────────────────        ───────────────
CreationEvent[]       Viewport{tx,ty,scale}         <canvas> + 2D ctx
   ↓ projectTree        ↑ wheel=缩放(向光标)          ctx.setTransform
TreeNode[]             ↑ 拖拽=平移                    画 edges → nodes
   ↓ layoutTree         ↑ click → hit-test            （视口剔除）
{x,y,w,h}+bounds       ↑ RAF 批处理重绘
```

| 组件 | 文件 | 职责 |
|---|---|---|
| **Viewport** | `viewport.ts` | `{tx,ty,scale}` 相机状态；`clampScale`；screen↔world 坐标换算 |
| **LayoutEngine** | `tree-layout.ts` | `layoutTree(roots) → {id→{x,y,w,h}, bounds}` 纯函数；**Strategy**（可换径向/力导向） |
| **CanvasRenderer** | `canvas-renderer.ts` | 画到 2D ctx；应用 viewport transform；**视口剔除**（只画可见节点）；复用 `wli-dot` 配色 |
| **HitTester** | `hit-tester.ts` | 屏幕点 → world 点（逆 transform）→ 命中节点；**O(n)** |
| **InputController** | `input-controller.ts` | wheel/drag/click → 改 viewport / 触发 openSource；**RAF 批处理**（一帧最多一次重绘） |
| **LinkTreeCanvas** | `link-tree-canvas.ts` | 组装：`mount(el)` / `update(tree)` / `destroy()`；挂 `<canvas>`、接 layout+projector、接 DPR/resize |

### 7.3 布局算法（MVP：自顶向下分层）

递归：叶子按序占据单位宽 x 槽，父节点居中于其子；y 按深度。**O(n)**，一次性算（仅数据变化时重算，pan/zoom 不重算）。宽树靠水平 pan 消化溢出。（完整 Reingold-Tilford 留 v2。）

### 7.4 交互（无 toolbar，极简）

- **缩放**：滚轮向光标，scale clamp `[0.2, 3]`；**双击画布复位** fitView（无顶栏按钮）
- **平移**：背景拖拽（pointer events）
- **折叠/展开**：每个有子节点的节点**右侧 +/− 圆形图标**——展开态显 `−`，折叠态显隐藏的后代数（蓝）；点击切换，状态跨重绘保持
- **点击节点 = 直接跳转**：`hit-tester` 命中节点体 → 构造伪 `LinkRow` 喂**现有** `openSource()`（`merged-view.ts:790`，`openFile + setCursor + scrollIntoView`）。**无中间详情弹窗**
- **悬停**：tooltip 预览 `target · 来源 sourcePath:行号`（只读，不跳转）
- **视觉**：created 绿 / pending 黄 / stale 灰；左侧状态色条 + 状态点；白底主题，从左到右布局

### 7.5 放置与 chrome（决策 D6/D11）

- 画布**占满「双链检查」zone**，**无顶部 toolbar**（进度行/图例/缩放按钮全移除，极简）
- 节点自身承担全部交互：右侧 +/− 折叠、点击跳转、悬停预览；**双击画布复位**
- 空间不足可选「展开 ⤢」→ 复用 Modal 弹全屏 canvas（参考 `WikilinkInspectorModal` 壳），同一套 `LinkTreeCanvas` 组件零重复
- 白底主题，从左到右布局

### 7.6 作用域：按当前笔记过滤（决策 D10）

「双链检查」zone 的树**只显示与当前打开笔记关联的子树**，无关联的不显示（如在 `概率论/` 笔记下不显示 `111/` 内存树）。

- **当前笔记**：复用 `merged-view.ts:780 getTargetMarkdownView()` 取 active markdown 文件路径
- **作用域键**：`zone = sourcePath 顶层文件夹`（`概率论/xxx.md` → `概率论`；根笔记 → `(root)`）
- **过滤**：`projectTree` 前 `events.filter(e => firstSeg(e.sourcePath) === zone)`；ghost 原生源同法判定
- 无 active 笔记 → 退化为显示全部
- 切笔记 → `refreshWli` 重算 + canvas 重绘（作用域变）

> 备选（v2）：改为「创建图中含当前笔记的连通分量」，更贴"关联"语义；本期按文件夹作用域，简单且与示例一致。

---

## 8. 模块布局与接入点

### 目标文件结构（`src/link-tree/`）

```
src/link-tree/
├── creation-event.ts          # CreationEvent 类型 + normalize() + dedup key
├── creation-tracker.ts        # capture(source, existingTargets, runId) → 新事件（纯函数, 注入 source）
├── tree-projector.ts          # projectTree(events, deps) + makeProjectDeps(app)（纯函数, O(E)）
├── tree-layout.ts             # layoutTree(roots) → 坐标+bounds（纯函数, Strategy）
├── viewport.ts                # Viewport 状态 + screen↔world 换算 + clamp
├── canvas-renderer.ts         # 画 2D ctx（视口剔除）
├── hit-tester.ts              # 屏幕点 → 命中节点（O(n)）
├── input-controller.ts        # wheel/drag/click（RAF 批处理）
├── link-tree-canvas.ts        # 组装 mount/update/destroy（挂 <canvas>）
├── link-tree-repository.ts    # PluginData.linkTree 的 load/appendAll/save
├── link-tree-view.ts          # 接 merged-view：zone 紧凑视图 + 全屏 Modal
├── creation-tracker.test.ts
├── tree-projector.test.ts
├── tree-layout.test.ts
└── hit-tester.test.ts
```

每个文件单一职责、200–400 行内（遵循 Small File Principle）；纯函数（tracker/projector/layout/hit-test）注入依赖、脱离 DOM、易测。

### 接入点（改动现有文件）

| 文件 | 改动 |
|---|---|
| `main.ts` | `PluginData` 加 `linkTree` 字段；`onload` 读 / `saveSettings` 写；构造 tracker + repo 注入 view；**`onRepairUnresolvedLinks` 在 `startOrCreateTab` 前调 `tracker.capture()` + `repo.appendAll()`** |
| `src/view/merged-view.ts` | `refreshWli()` 里调 `linkTreeView.update(activeNotePath)`（投影走 Obsidian O(1) 查询，**不依赖 `this.rows`**；按当前笔记顶层文件夹过滤事件）；`buildWliSection()` 挂满幅 canvas（无 toolbar）；`getTargetMarkdownView()` 提供当前笔记 |
| `src/backup/data-backup.ts` | `BackupPayload` 纳入 `linkTree` |

### 复用盘点

| 新逻辑 | 复用的现成件 | 位置 |
|---|---|---|
| 捕获源 | `makeSource(app)`（CollectorSource, 带 ctime） | `merged-view.ts:56` |
| 收集未解析（含位置+ctime） | `collectRows(source)` + 过滤 unresolved | `link-collector.ts` |
| 投影状态查询 | `getFirstLinkpathDest` / `getAbstractFileByPath` | Obsidian metadataCache / vault |
| 跳转 | `openSource(row)` | `merged-view.ts:790` |
| 链接行类型 | `LinkRow` / `partitionByState` | `link-row.ts` |
| Modal 壳 | `WikilinkInspectorModal` 结构 | `inspector-modal.ts` |
| 纯函数风格 | 逻辑纯函数 + 注入依赖 + 分离渲染 | 全模块既有约定 |

---

## 9. 边界与错误处理

| 场景 | 处理 |
|---|---|
| 完善进程异常退出 | capture 已在点击时落库，与进程成败无关；status 由后续 refresh 派生（没创建则长期 pending） |
| 同一 target 多次完善点击 | 按 target 去重，只记首次捕获；后续点击跳过该 target |
| pending 永不变成 created | 正常现象——表示完善没创建它；树里持续显示 pending（进度视图的一部分） |
| 触发源笔记被删除 | 投影 `isStale`=true（`getAbstractFileByPath` 返回 null）→ 灰显；不影响其余结构 |
| 中间节点被删除 | 派生：其子节点 parentKey 不再命中 → 自动提升为根 |
| 手动（非完善）创建笔记 | 该 target 若曾被 capture，status 实时翻为 created（属性归到完善批次，可接受的小误差） |
| capture 时拿不到 vault 路径 / source 为空 | 不 append，Notice 提示；不抛 |
| `linkTree` schema 变更 | `version` + 迁移函数（类比 `migrateCommandGroups`） |
| 画布容器 resize / DPR 变化 | `LinkTreeCanvas` 监听 resize，重设 canvas 尺寸 + 重绘 |
| 节点极多（数百+） | 视口剔除 + RAF 批处理兜底；超出再上空间索引（v2） |

---

## 10. 存储结构（从设计模式确定）

### 10.1 数据形状（唯一存储）

见 §4.1：`LinkTreeStore = { events: CreationEvent[], version }`，落 `PluginData.linkTree`。**append-only，不可变。**

### 10.2 存 vs 派生（Normalization / SSOT）

| 字段 | 处理 | 依据 |
|---|---|---|
| `target / sourcePath / position / firstSeenAt / runId / id` | **存** | 不可派生的事实（捕获那一刻的输入） |
| `status` (pending/created) | **派生**（Obsidian O(1) 查询） | Event Sourcing 投影；存了会腐化 |
| `parent / children` | **派生**（事件索引） | 不依赖外部状态 |
| `isStale` | **派生**（Obsidian O(1) 查询） | 同 status |
| `refs` | **延迟派生**（按需 O(R) 反链） | 仅展示用，踢出热路径 |
| 节点坐标 `x/y` | **派生**（layoutTree） | 视口/尺寸一变即失效 |

### 10.3 决策 → 设计模式

| 决策 | 模式 | 体现 |
|---|---|---|
| 存 append-only 事件、不存状态 | **Event Sourcing** | events 是不可变事实日志；树/状态/坐标都是投影 |
| 只存不可派生事实 | **Normalization / SSOT** | status/parent/children/坐标全不入库，避免双源真相 |
| 写只追加、不原地改 | **Immutable Log（CQRS 写侧）** | 无并发/合并问题；debounce 刷新与多次点击互不干扰 |
| 读侧算视图 | **Projection（CQRS 读侧）** | `projectTree`/`layoutTree` 是可丢弃读模型，日志才是真相 |
| status 走平台索引而非自扫 | **查索引不扫集合** | 复用 Obsidian O(1) 哈希索引，投影 O(E) 与 R 解耦 |
| load/append/save 封装 | **Repository** | `LinkTreeRepository` 隔离 `PluginData` |
| `version` + 迁移 | **Schema Versioning** | 类比 `migrateCommandGroups`，前向兼容 |

> 一句话：**存储 = Event Sourcing 的 append-only 事件日志；树/状态/坐标全是投影，零冗余存储；投影复用平台索引，O(E) 与 vault 大小解耦。**

---

## 11. 测试策略

沿用 vitest + 纯函数注入：

- **`tree-projector.test.ts`**：注入假 `ProjectDeps`（isResolved/sourceExists）；单根、单链 A→B→C、多根森林；晚到父节点自动重挂；中间节点删除→子提升根；`status` 派生（pending/created，靠 isResolved 注入）；`isStale`（靠 sourceExists 注入）；同 target 多事件取最新
- **`creation-tracker.test.ts`**：注入假 source；capture 产出正确事件；主源选择（多源取 ctime 最大）；去重（已存在 target 跳过）；空/全/部分
- **`tree-layout.test.ts`**：坐标在 bounds 内；父居中于子；深度递增；无重叠
- **`hit-tester.test.ts`**：屏幕点↔world 换算；命中/未命中；缩放平移下命中正确
- **`link-tree-repository.test.ts`**：append 后 load 一致；空 data 首次返回空
- canvas 渲染（`canvas-renderer`/`input-controller`）走人工/视觉验证（DOM 类逻辑用 hit-tester 单测覆盖核心）

---

## 12. 决策点

| # | 决策点 | 采用 | 理由 |
|---|---|---|---|
| D1 | 存储结构 | append-only `CreationEvent` 日志，树/状态/坐标零存储 | Event Sourcing + Normalization，防腐化 |
| D2 | root/leaf 落库 | 无独立路径，全靠 `projectTree` 派生 | append 单一路径，晚到父节点自动重挂 |
| D3 | 检测模型 | **capture（模型 B）** | 更简单、无 afterRun/diff/时序风险、进度含 pending |
| D4 | 去重 | 按 `normalize(target)` | 同一双链多次点击只记一次 |
| D5 | 渲染技术 | **HTML5 `<canvas>`** | 适配 100+ 节点；SVG 在此量级 DOM 开销大 |
| D6 | 画布放置 | zone 紧凑 + 全屏 Modal 展开 | 侧边栏窄，100+ 节点需空间；复用同一 canvas 组件 |
| D7 | 布局 | 自顶向下分层（MVP） | O(n)、可读；Reingold-Tilford / 径向留 v2 |
| D8 | 持久化位置 | `PluginData.linkTree`（扩展现有 saveData） | 一致性 > 隔离性 |
| D9 | 投影算法 | Obsidian O(1) 查询派生 status/isStale，refs 延迟 | 投影 O(E)，与 vault 大小解耦 |
| D10 | 作用域 | 按当前笔记的顶层文件夹过滤树 | 概率论下不显示内存树；简单且与示例一致 |
| D11 | 交互 chrome | 无 toolbar；节点 +/− 折叠、点击直接跳转、双击复位 | 极简，节点自承载交互 |

---

## 13. 性能分析与优化

### 13.1 成本模型

| 路径 | 触发 | 现有成本 | 本设计增量 | 结论 |
|---|---|---|---|---|
| **编辑/刷新（热）** | 笔记编辑（400ms 防抖） | `refreshWli` 全 vault 扫描 O(R)（既有） | `projectTree` **O(E)**（Obsidian 查询, 不扫 rows）+ `layoutTree` O(E) + canvas 重绘 | 本设计新增 <1ms, 不恶化热路径 |
| **完善捕获（冷）** | 用户点完善 | —— | 1 次 `collectRows` 全扫描 + append | 可接受（≈ 一次「清除全部」，百毫秒级；无第二次扫描） |
| **pan/zoom（交互）** | 拖拽/滚轮 | —— | 仅 viewport transform 变 → 全量重绘（RAF 批 + 视口剔除） | 100+ 节点 60fps 稳定 |
| **持久化** | 仅捕获批次末尾 | —— | `saveData` 一次 | 非热路径 |

### 13.2 已内建优化

1. **投影走 Obsidian O(1) 索引**：status/isStale 用 `getFirstLinkpathDest`/`getAbstractFileByPath`（哈希查），parent/children 用事件索引；整投影 **O(E)**，与 vault 链接数 R 无关。`refs` 延迟到按需（O(R) 反链查询，踢出热路径）。
2. **normalize 只算一次**：建事件索引时缓存 `normTarget`，避免热循环重复 `split`/`replace`。
3. **布局仅数据变化时重算**：pan/zoom 不重算 layout，只改 viewport transform。
4. **RAF 批处理重绘**：wheel/drag 连续事件合并为一帧一次 canvas 重绘。
5. **视口剔除**：重绘时只画 world bounds 与可视区相交的节点，数百节点也只画屏内几十个。
6. **渲染默认折叠 + 全屏 Modal**：紧凑态只画摘要，全屏才展开全树。

### 13.3 可选优化（profile 后再上）

- **空间索引命中检测**：节点上千时把 O(n) hit-test 换成网格/四叉树。
- **events 上限（安全阀）**：append-only 无限增长；可加可配置上限（最近 N 条 / 时间窗）滚动淘汰。
- **增量重绘**：脏区重绘而非全量（canvas 通常不必，全量已够快）。

### 13.4 真正的瓶颈（非本设计）

`collectRows` 的 O(R) 全 vault 扫描是 WLI **既有成本**，每次编辑触发。超大 vault（百万链接）会逼近 100ms+ 引起编辑卡顿。但这是既有问题、超出本期范围——本设计用 O(E) 投影避开了雪上加霜。若未来要治，是对 `collectRows` 做增量索引，跟树无关。

---

## 14. 未来工作（v2，本期不做）

- 完善运行中实时进度预览（叠加 `metadataCache.on("resolved")`，不落库）
- 手动新建笔记也纳入树（需区分来源）
- 整批撤销（按 `runId` 删除某次捕获的所有事件）
- 同 target 多次捕获的「历史记录」折叠视图
- 树节点搜索 / 筛选（复用 Modal 搜索模式）
- 高级布局（Reingold-Tilford / 径向 / 力导向）
- 导出树为 Markdown / Obsidian Canvas(.canvas)

---

## 附：术语表

| 术语 | 含义 |
|---|---|
| 完善 | 「完善」按钮触发的、由外部 Claude 进程执行的未解析双链补全/创建动作 |
| 捕获事件 (CreationEvent) | 点击完善时、某个当前未解析双链被记录的不可变条目 |
| capture 模型（模型 B） | 点击时捕获未解析双链、状态实时派生的检测方式（无 diff） |
| 主源 (primary source) | 某 target 的多个源笔记中 `sourceCtime` 最大者 |
| 投影 (projection) | 由事件日志 + Obsidian 索引实时算出的树/状态/坐标，不落库 |
| 根 (root) | 触发源不是捕获目标的捕获事件 |
| 叶 (leaf) | 触发源也是捕获目标的捕获事件 |
| status | 派生（O(1) 查询）：`created`（target 已解析）/ `pending`（仍未解析） |
| `isStale` | 派生（O(1) 查询）：源笔记在当前 vault 已不存在 |
| ProjectDeps | 注入 Obsidian O(1) 查询的依赖接口（isResolved/sourceExists），保纯函数可测 |
| Viewport | canvas 相机状态 `{tx, ty, scale}`，pan/zoom 改它 |
